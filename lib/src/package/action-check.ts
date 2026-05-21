/* eslint-disable no-console */
import path from 'node:path';

import { FiledistExtractEntry, ProgressEvent, BasicPackageOptions } from '../types';
import { cleanupTempPackageJson, formatDisplayPath } from '../utils';
import { checkFileset } from '../fileset/check';

import { resolveFilesDetailed } from './resolve-files';
import { calculateDiff } from './calculate-diff';
import { isManagedSymlinkEntry } from './symlinks';
import { createSourceRuntime } from './source';
import { readLockfile, readManagedFilesForDir, LOCKFILE_NAME } from './lockfile';

export type CheckOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
  /**
   * When true, skip all package installs and git clones.
   * Integrity is verified solely against the checksums stored in .filedist markers.
   * Extra-file detection (files in source not yet extracted) is also skipped.
   */
  localOnly?: boolean;
  /**
   * When true (default for CLI), read set definitions and package versions exclusively
   * from .filedist.lock. Fails if no lock file is found.
   * When false, use the entries and versions passed via options (library/direct callers).
   */
  frozenLockfile?: boolean;
};

export type CheckSummary = {
  ok: number;
  missing: string[];
  conflict: string[];
  extra: string[];
};

/**
 * Check whether the output directories are in sync with the desired file state.
 *
 * When frozenLockfile=true (the CLI default): reads set definitions and pinned
 * package versions exclusively from .filedist.lock. Fails if no lock file found.
 *
 * When frozenLockfile=false (direct library callers): uses resolveFiles() with
 * the entries supplied in options.
 *
 * Conflict detection reports content/managed mismatches only — gitignore-only
 * conflicts are excluded since gitignore state is managed by extract, not a data
 * integrity issue.
 */
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const {
    cwd,
    verbose = false,
    onProgress,
    localOnly = false,
    frozenLockfile = false,
    entries: initialEntries,
  } = options;
  let entries = initialEntries;
  let lockedVersions: Map<string, string> | undefined;

  // ── Frozen mode: read entries and locked versions from lockfile ──────────
  if (frozenLockfile) {
    const resolved = resolveFrozenLockfileContext(cwd, initialEntries, verbose, 'actionCheck');
    ({ entries, lockedVersions } = resolved);
  }

  const summary: CheckSummary = { ok: 0, missing: [], conflict: [], extra: [] };

  // Skip entries with managed=false — they write no marker so there is nothing to check.
  const managedEntries = entries.filter((e) => e.output?.managed !== false);
  if (managedEntries.length === 0) return summary;

  // --local-only: verify only against .filedist markers without touching any package source.
  if (localOnly) {
    if (verbose) {
      console.log(`[verbose] actionCheck: local-only mode (cwd: ${formatDisplayPath(cwd, cwd)})`);
    }
    const checkedDirs = new Set<string>();
    for (const entry of managedEntries) {
      const outputDir = path.resolve(cwd, entry.output?.path ?? '.');
      if (checkedDirs.has(outputDir)) continue;
      checkedDirs.add(outputDir);

      // readManagedFilesForDir verifies managed files from .filedist.lock.
      const marker = readManagedFilesForDir(cwd, outputDir);
      // eslint-disable-next-line unicorn/no-null
      const checkResult = await checkFileset(null, outputDir, marker);

      summary.missing.push(...checkResult.missing);
      summary.conflict.push(...checkResult.modified);
      // extra is skipped in local-only mode (no package source to enumerate)
      summary.ok += marker.length - checkResult.missing.length - checkResult.modified.length;

      if (verbose) {
        console.log(
          `[verbose] actionCheck local-only: ${formatDisplayPath(outputDir, cwd)}: ` +
            `missing=${checkResult.missing.length} modified=${checkResult.modified.length}`,
        );
      }
    }
    return summary;
  }

  const sourceRuntime = createSourceRuntime(cwd, verbose);

  if (verbose) {
    console.log(`[verbose] actionCheck: resolving files (cwd: ${formatDisplayPath(cwd, cwd)})`);
  }

  try {
    const resolved = await resolveFilesDetailed(managedEntries, {
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
      console.log(`[verbose] actionCheck: resolved ${resolvedFiles.length} desired file(s)`);
    }

    const managedResolvedFiles = resolvedFiles.filter((f) => f.managed);
    const diff = await calculateDiff(
      managedResolvedFiles,
      verbose,
      cwd,
      resolved.relevantPackagesByOutputDir,
    );

    summary.ok += diff.ok.length;
    summary.missing.push(...diff.missing.map((e) => e.relPath));
    summary.extra.push(
      ...diff.extra
        .filter((e) => !e.existing || !isManagedSymlinkEntry(e.existing))
        .map((e) => e.relPath),
    );
    // Only report conflicts where content or managed-state differ; gitignore-only
    // mismatches are not a data integrity issue.
    const reportedConflicts = diff.conflict.filter((e) =>
      (e.conflictReasons ?? []).some((r) => r !== 'gitignore'),
    );
    summary.conflict.push(...reportedConflicts.map((e) => e.relPath));
    // Files with only a gitignore conflict are not reported as conflicts,
    // so count them as ok (consistent: ok + missing + conflict + extra = total).
    const gitignoreOnlyCount = diff.conflict.length - reportedConflicts.length;
    summary.ok += gitignoreOnlyCount;

    if (verbose) {
      console.log(
        `[verbose] actionCheck: ok=${summary.ok} missing=${summary.missing.length}` +
          ` conflict=${summary.conflict.length} extra=${summary.extra.length}`,
      );
    }

    return summary;
  } finally {
    sourceRuntime.cleanup();
    cleanupTempPackageJson(cwd, verbose);
  }
}

/**
 * Shared helper: read entries and locked package versions from .filedist.lock.
 * Throws when the lock file is absent.
 */
export function resolveFrozenLockfileContext(
  cwd: string,
  fallbackEntries: FiledistExtractEntry[],
  verbose: boolean,
  caller = 'action',
): { entries: FiledistExtractEntry[]; lockedVersions: Map<string, string> } {
  const lockfileData = readLockfile(cwd);
  if (!lockfileData) {
    throw new Error(`Lock file ${LOCKFILE_NAME} not found. Run 'filedist install' first.`);
  }
  const entries =
    lockfileData.sets && lockfileData.sets.length > 0 ? lockfileData.sets : fallbackEntries;
  const lockedVersions = new Map(
    Object.entries(lockfileData.packages).map(([spec, entry]) => [spec, entry.ref]),
  );
  if (verbose) {
    console.log(
      `[verbose] ${caller}: frozen mode — ${entries.length} set(s), ` +
        `${lockedVersions.size} locked package(s)`,
    );
  }
  return { entries, lockedVersions };
}
