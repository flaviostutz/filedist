/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import { ProgressEvent, BasicPackageOptions, DiffEntry } from '../types';
import { cleanupTempPackageJson, formatDisplayPath } from '../utils';
import { removeFromGitignore, readManagedGitignoreEntries } from '../fileset/gitignore';

import { removeAllSymlinks } from './symlinks';
import { resolveFilesDetailed } from './resolve-files';
import { calculateDiff } from './calculate-diff';
import { createSourceRuntime } from './source';
import { readManagedFilesForDir, writeManagedFilesForDir } from './lockfile';
import { resolveFrozenLockfileContext } from './action-check';

export type PurgeOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
  /**
   * When true (default for CLI), read set definitions and package versions exclusively
   * from .filedist.lock. Fails if no lock file is found.
   * When false, use the entries and versions passed via options (library/direct callers).
   */
  frozenLockfile?: boolean;
};

export type PurgeSummary = {
  deleted: number;
  symlinksRemoved: number;
  dirsRemoved: number;
};

/**
 * Purge all managed files for the given entries.
 *
 * When frozenLockfile=true (the CLI default): reads set definitions and pinned
 * package versions exclusively from .filedist.lock. Fails if no lock file found.
 *
 * Uses resolveFiles() to build the desired file list (installing packages as needed),
 * then calculateDiff() to find the managed files on disk. Deletes ok, conflict,
 * and extra files (i.e. everything currently managed by filedist for these packages).
 * Updates .filedist markers and .gitignore entries for affected output directories.
 */
export async function actionPurge(options: PurgeOptions): Promise<PurgeSummary> {
  const {
    cwd,
    dryRun = false,
    verbose = false,
    onProgress,
    frozenLockfile = false,
    entries: initialEntries,
  } = options;
  let entries = initialEntries;
  let lockedVersions: Map<string, string> | undefined;

  // ── Frozen mode: read entries and locked versions from lockfile ──────────
  if (frozenLockfile) {
    const resolved = resolveFrozenLockfileContext(cwd, initialEntries, verbose, 'actionPurge');
    ({ entries, lockedVersions } = resolved);
  }

  const summary: PurgeSummary = { deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 };
  const sourceRuntime = createSourceRuntime(cwd, verbose);

  if (verbose) {
    console.log(`[verbose] actionPurge: resolving files (cwd: ${formatDisplayPath(cwd, cwd)})`);
  }

  try {
    const resolved = await resolveFilesDetailed(entries, {
      cwd,
      verbose,
      sourceRuntime,
      lockedVersions,
      onProgress: (e) => {
        if (e.type === 'package-start' || e.type === 'package-end') onProgress?.(e);
      },
    });
    const resolvedFiles = resolved.files;

    if (verbose) {
      console.log(`[verbose] actionPurge: resolved ${resolvedFiles.length} desired file(s)`);
    }

    const managedResolvedFiles = resolvedFiles.filter((f) => f.managed);
    const diff = await calculateDiff(
      managedResolvedFiles,
      verbose,
      cwd,
      resolved.relevantPackagesByOutputDir,
    );

    // Purge: ok (present+matching), conflict (present+mismatched), extra (stale managed)
    const filesToDelete = [...diff.ok, ...diff.conflict, ...diff.extra];

    if (verbose) {
      console.log(
        `[verbose] actionPurge: ${filesToDelete.length} file(s) to delete` +
          ` (ok=${diff.ok.length} conflict=${diff.conflict.length} extra=${diff.extra.length})`,
      );
    }

    // Group by outputDir
    const byOutputDir = new Map<string, typeof filesToDelete>();
    for (const entry of filesToDelete) {
      const arr = byOutputDir.get(entry.outputDir) ?? [];
      arr.push(entry);
      byOutputDir.set(entry.outputDir, arr);
    }

    for (const [outputDir, dirEntries] of byOutputDir) {
      await purgeOutputDir(outputDir, dirEntries, dryRun, summary, cwd, onProgress, verbose);
    }

    return summary;
  } finally {
    sourceRuntime.cleanup();
    cleanupTempPackageJson(cwd, verbose);
  }
}

async function purgeOutputDir(
  outputDir: string,
  entries: DiffEntry[],
  dryRun: boolean,
  summary: PurgeSummary,
  cwd: string,
  onProgress: PurgeOptions['onProgress'],
  verbose: boolean,
): Promise<void> {
  const relPaths = entries.map((e) => e.relPath);
  const gitignorePaths = readManagedGitignoreEntries(outputDir);

  for (const entry of entries) {
    const fullPath = path.join(outputDir, entry.relPath);
    if (fs.existsSync(fullPath)) {
      if (!dryRun) {
        try {
          fs.chmodSync(fullPath, 0o644);
          fs.unlinkSync(fullPath);
        } catch {
          // ignore deletion errors
        }
      }
      summary.deleted++;
      const pkgName = entry.desired?.packageName ?? entry.existing?.packageName ?? '';
      onProgress?.({
        type: 'file-deleted',
        packageName: pkgName,
        file: entry.relPath,
        managed: true,
        gitignore: gitignorePaths.has(entry.relPath),
      });
    }
  }

  if (!dryRun && relPaths.length > 0) {
    summary.symlinksRemoved += await removeAllSymlinks(outputDir);
    summary.dirsRemoved += removeEmptyDirs(outputDir);
    await updateMarkerAfterPurge(outputDir, new Set(relPaths), cwd);
    await removeFromGitignore(outputDir, relPaths);
  }

  if (verbose) {
    console.log(
      `[verbose] actionPurge: ${formatDisplayPath(outputDir, cwd)} — deleted ${relPaths.length} file(s)`,
    );
  }
}

async function updateMarkerAfterPurge(
  outputDir: string,
  purgedPaths: Set<string>,
  cwd: string,
): Promise<void> {
  const current = readManagedFilesForDir(cwd, outputDir);
  const updated = current.filter((m) => !purgedPaths.has(m.path));
  writeManagedFilesForDir(cwd, outputDir, updated);
}

function removeEmptyDirs(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  const recurse = (d: string): void => {
    for (const e of fs.readdirSync(d)) {
      const full = path.join(d, e);
      if (fs.statSync(full).isDirectory()) recurse(full);
    }
    try {
      if (d !== dir && fs.readdirSync(d).length === 0) {
        fs.rmdirSync(d);
        count++;
      }
    } catch {
      // ignore
    }
  };
  recurse(dir);
  return count;
}
