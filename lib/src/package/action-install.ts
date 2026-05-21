/* eslint-disable no-process-env */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import {
  ResolvedFile,
  DiffResult,
  ProgressEvent,
  BasicPackageOptions,
  ManagedFileMetadata,
} from '../types';
import {
  cleanupTempPackageJson,
  ensureDir,
  formatDisplayPath,
  hashFileSync,
  shortenChecksum,
} from '../utils';
import { writeMarker, readOutputDirMarker, markerPath } from '../fileset/markers';
import { addToGitignore, readManagedGitignoreEntries } from '../fileset/gitignore';

import {
  collectManagedSymlinkEntries,
  createSymlinks,
  findManagedSymlinkEntries,
  isManagedFileEntry,
  removeStaleSymlinks,
  uniqueSymlinkConfigs,
} from './symlinks';
import { applyContentReplacements } from './content-replacements';
import { resolveFilesDetailed } from './resolve-files';
import { calculateDiff } from './calculate-diff';
import { createSourceRuntime } from './source';
import { readLockfile, writeLockfile, buildLockfileData } from './lockfile';

export type InstallOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
  /**
   * When true, read .filedist.lock and use it to pin package versions.
   * Fails if no lock file is found. Does not update the lock file.
   * When false (default), resolve normally and write/update .filedist.lock.
   * When undefined, the value is derived from the CI environment variable:
   * if process.env.CI is set (and not 'false'), behaves as true.
   */
  frozenLockfile?: boolean;
};

export type InstallResult = {
  added: number;
  modified: number;
  deleted: number;
  skipped: number;
};

/**
 * Install managed files into the output directories.
 *
 * Two-phase approach:
 *  1. resolveFiles — installs packages and builds the complete desired file list.
 *  2. calculateDiff — compares desired files against each output directory.
 *  3. Apply disk changes: delete extra, add missing, resolve conflicts.
 *
 * Lock file behaviour:
 *  - Without frozenLockfile (and CI env not set): resolve normally, then write/update .filedist.lock.
 *  - With frozenLockfile (or when process.env.CI is set): read .filedist.lock (error if missing),
 *    use pinned versions, skip lock file update.
 */
// eslint-disable-next-line complexity
export async function actionInstall(options: InstallOptions): Promise<InstallResult> {
  const { entries, cwd, verbose = false, onProgress, dryRun } = options;
  // Auto-enable frozen lockfile in CI environments
  const frozenLockfile = options.frozenLockfile ?? (!!process.env.CI && process.env.CI !== 'false');
  const isDryRun = dryRun ?? entries.some((e) => e.output?.dryRun === true);
  const sourceRuntime = createSourceRuntime(cwd, verbose);

  // ── Lock file handling — resolve locked versions before resolution phase ────
  let lockedVersions: Map<string, string> | undefined;
  if (frozenLockfile) {
    const lockfileData = readLockfile(cwd);
    if (!lockfileData) {
      throw new Error(
        `Lock file ${'.filedist.lock'} not found. ` +
          `Run 'filedist install' without --frozen-lockfile first.`,
      );
    }
    lockedVersions = new Map(
      Object.entries(lockfileData.packages).map(([spec, entry]) => [spec, entry.ref]),
    );
    if (verbose) {
      console.log(
        `[verbose] actionInstall: using frozen lock file (${lockedVersions.size} entries)`,
      );
    }
  }

  const result: InstallResult = { added: 0, modified: 0, deleted: 0, skipped: 0 };
  try {
    // ── Phase 1: Resolve desired files ──────────────────────────────────────
    const resolved = await resolveFilesDetailed(entries, {
      cwd,
      verbose,
      onProgress,
      sourceRuntime,
      lockedVersions,
    });
    const resolvedFiles = resolved.files;
    const { noSyncOutputDirs, relevantPackagesByOutputDir, resolvedPackages } = resolved;

    if (verbose) {
      console.log(`[verbose] actionInstall: resolved ${resolvedFiles.length} desired file(s)`);
    }

    // ── Phase 2: Calculate diff ──────────────────────────────────────────────
    const diff = await calculateDiff(
      resolvedFiles,
      verbose,
      cwd,
      relevantPackagesByOutputDir,
      true,
    );

    if (verbose) {
      console.log(
        `[verbose] actionInstall: diff ok=${diff.ok.length} missing=${diff.missing.length}` +
          ` conflict=${diff.conflict.length} extra=${diff.extra.length}`,
      );
    }

    const fileMissingEntries = diff.missing.filter((entry) => entry.desired);
    const fileOkEntries = diff.ok.filter((entry) => entry.desired);
    const fileConflictEntries = diff.conflict.filter((entry) => entry.desired);

    // ── Pre-flight conflict check ──────────────────────────────────────────
    // Detect unmanaged-file conflicts before any disk writes.
    if (!isDryRun) {
      if (verbose) {
        console.log(`[verbose] actionInstall: checking for possible file conflicts...`);
      }
      for (const entry of fileConflictEntries) {
        const desired = entry.desired!;
        const isUnmanagedConflict = !entry.existing && desired.managed;
        if (!desired.mutable && !desired.force && isUnmanagedConflict) {
          throw new Error(
            `Conflict: file "${entry.relPath}" in "${entry.outputDir}" exists and is not managed` +
              ` by filedist.\nUse --force to overwrite or --managed=false to skip.`,
          );
        }
      }
    }

    // ── Count expected changes ─────────────────────────────────────────────
    result.added = fileMissingEntries.length;
    result.deleted = diff.extra.filter(
      (entry) => isManagedFileEntry(entry.existing!) && !noSyncOutputDirs.has(entry.outputDir),
    ).length;
    for (const entry of fileConflictEntries) {
      const desired = entry.desired!;
      if (desired.mutable || !desired.managed) {
        result.skipped++;
      } else {
        result.modified++;
      }
    }
    result.skipped += fileOkEntries.length;

    if (isDryRun) return result;

    // ── Phase 3: Apply disk changes ──────────────────────────────────────────

    // Collect unique output directories
    const outputDirs = new Set<string>([
      ...resolvedFiles.map((f) => f.outputDir),
      ...relevantPackagesByOutputDir.keys(),
    ]);

    // Delete extra managed files
    if (verbose) {
      console.log(`[verbose] actionInstall: removing extra managed files...`);
    }
    for (const entry of diff.extra.filter(
      (diffEntry) =>
        isManagedFileEntry(diffEntry.existing!) && !noSyncOutputDirs.has(diffEntry.outputDir),
    )) {
      const { outputDir, relPath, existing } = entry;
      const fullPath = path.join(outputDir, relPath);
      const gitignorePaths = readManagedGitignoreEntries(outputDir);
      if (fs.existsSync(fullPath)) {
        fs.chmodSync(fullPath, 0o644);
        fs.unlinkSync(fullPath);
      }
      onProgress?.({
        type: 'file-deleted',
        packageName: existing?.packageName ?? '',
        file: relPath,
        managed: true,
        gitignore: gitignorePaths.has(relPath),
      });
    }

    // Add missing files
    if (verbose) {
      console.log(`[verbose] actionInstall: adding missing files...`);
    }
    for (const entry of fileMissingEntries) {
      const desired = entry.desired!;
      writeFileToOutput(
        desired.sourcePath,
        path.join(entry.outputDir, desired.relPath),
        desired.managed,
      );
      onProgress?.({
        type: 'file-added',
        packageName: desired.packageName,
        file: desired.relPath,
        managed: desired.managed,
        gitignore: desired.gitignore,
      });
    }

    // Emit file-skipped for unchanged files (diff.ok)
    for (const entry of fileOkEntries) {
      const desired = entry.desired!;
      onProgress?.({
        type: 'file-skipped',
        packageName: desired.packageName,
        file: desired.relPath,
        managed: desired.managed,
        gitignore: desired.gitignore,
      });
    }

    // Resolve conflicts
    if (verbose) {
      console.log(`[verbose] actionInstall: resolving file conflicts...`);
    }
    for (const entry of fileConflictEntries) {
      const desired = entry.desired!;
      // managed=false: existing file is user-owned, leave it untouched
      if (desired.mutable || !desired.managed) {
        onProgress?.({
          type: 'file-skipped',
          packageName: desired.packageName,
          file: desired.relPath,
          managed: desired.managed,
          gitignore: desired.gitignore,
        });
        continue;
      }
      writeFileToOutput(
        desired.sourcePath,
        path.join(entry.outputDir, desired.relPath),
        desired.managed,
      );
      onProgress?.({
        type: 'file-modified',
        packageName: desired.packageName,
        file: desired.relPath,
        managed: desired.managed,
        gitignore: desired.gitignore,
      });
    }

    // Apply symlinks and content replacements per output directory
    if (verbose) {
      console.log(`[verbose] actionInstall: applying symlinks and content replacements...`);
    }
    for (const outputDir of outputDirs) {
      const dirFiles = resolvedFiles.filter((f) => f.outputDir === outputDir);
      const relevantPackages = relevantPackagesByOutputDir.get(outputDir);
      const existingMarker = await readOutputDirMarker(outputDir);
      const desiredSymlinkEntries = collectManagedSymlinkEntries(outputDir, dirFiles);
      const desiredSymlinkPaths = new Set(desiredSymlinkEntries.map((entry) => entry.path));
      const managedSymlinks = findManagedSymlinkEntries(existingMarker, relevantPackages);

      if (managedSymlinks.length > 0) {
        const removedSymlinkPaths = await removeStaleSymlinks(
          outputDir,
          managedSymlinks,
          desiredSymlinkPaths,
        );
        result.deleted += removedSymlinkPaths.length;
        for (const relPath of removedSymlinkPaths) {
          onProgress?.({
            type: 'file-deleted',
            packageName: managedSymlinks.find((entry) => entry.path === relPath)?.packageName ?? '',
            file: relPath,
            managed: true,
            gitignore: false,
          });
        }
      }

      const symlinkConfigs = uniqueSymlinkConfigs(dirFiles);
      if (symlinkConfigs.length > 0) {
        await createSymlinks(outputDir, symlinkConfigs);
      }
      const contentReplacements = dirFiles.flatMap((f) => f.contentReplacements);
      if (contentReplacements.length > 0) {
        await applyContentReplacements(outputDir, contentReplacements);
      }

      await updateOutputDirMetadata(
        outputDir,
        diff,
        dirFiles,
        desiredSymlinkEntries,
        relevantPackages,
        noSyncOutputDirs.has(outputDir),
        cwd,
        verbose,
      );
    }

    if (verbose) {
      console.log(
        `[verbose] actionInstall: complete — added=${result.added} modified=${result.modified}` +
          ` deleted=${result.deleted} skipped=${result.skipped}`,
      );
    }

    // ── Write/update lock file (only when not frozen) ───────────────────────
    if (!isDryRun && !frozenLockfile) {
      const lockfileData = buildLockfileData(resolvedPackages);
      writeLockfile(cwd, lockfileData);
      if (verbose) {
        console.log(
          `[verbose] actionInstall: lock file updated (${Object.keys(lockfileData.packages).length} package(s))`,
        );
      }
    }

    return result;
  } finally {
    sourceRuntime.cleanup();
    cleanupTempPackageJson(cwd, verbose);
  }
}

/** Copy a source file to dest, creating parent dirs if needed, and set permissions. */
function writeFileToOutput(srcPath: string, destPath: string, managed: boolean): void {
  ensureDir(path.dirname(destPath));
  if (fs.existsSync(destPath)) fs.chmodSync(destPath, 0o644);
  fs.copyFileSync(srcPath, destPath);
  if (managed) fs.chmodSync(destPath, 0o444);
}

/**
 * Update the .filedist marker and .gitignore for one output directory after
 * disk changes have been applied.
 */
async function updateOutputDirMetadata(
  outputDir: string,
  diff: DiffResult,
  resolvedFiles: ResolvedFile[],
  desiredSymlinkEntries: ManagedFileMetadata[],
  relevantPackages: Set<string> | undefined,
  noSync: boolean,
  cwd: string,
  verbose?: boolean,
): Promise<void> {
  const existingMarker = await readOutputDirMarker(outputDir);

  // Paths removed by this run (extra files that were deleted)
  const deletedPaths = new Set(
    diff.extra
      .filter((e) => e.outputDir === outputDir && isManagedFileEntry(e.existing!) && !noSync)
      .map((e) => e.relPath),
  );

  // New or updated managed entries produced by this run
  const addedEntries: ManagedFileMetadata[] = [
    ...diff.missing
      .filter((e) => e.outputDir === outputDir && e.desired?.managed)
      .map((e) => {
        const destPath = path.join(outputDir, e.relPath);
        const checksumValue = fs.existsSync(destPath)
          ? shortenChecksum(hashFileSync(destPath))
          : '';
        return {
          path: e.relPath,
          packageName: e.desired!.packageName,
          packageVersion: e.desired!.packageVersion,
          kind: 'file' as const,
          ...(checksumValue ? { checksum: checksumValue } : {}),
          ...(e.desired!.mutable ? { mutable: true as const } : {}),
        };
      }),
    ...diff.conflict
      .filter(
        (e) => e.outputDir === outputDir && !!e.desired && e.desired.managed && !e.desired.mutable,
      )
      .map((e) => {
        const destPath = path.join(outputDir, e.relPath);
        const checksumValue = fs.existsSync(destPath)
          ? shortenChecksum(hashFileSync(destPath))
          : '';
        return {
          path: e.relPath,
          packageName: e.desired!.packageName,
          packageVersion: e.desired!.packageVersion,
          kind: 'file' as const,
          ...(checksumValue ? { checksum: checksumValue } : {}),
          ...(e.desired!.mutable ? { mutable: true as const } : {}),
        };
      }),
  ];

  const currentRelevantPackages =
    relevantPackages ?? new Set(resolvedFiles.map((file) => file.packageName));

  // Merge: keep existing (minus deleted + newly updated), then add new entries
  const updatedByPath = new Map(
    existingMarker
      .filter(
        (m) =>
          !deletedPaths.has(m.path) &&
          !addedEntries.some((e) => e.path === m.path) &&
          !(
            (m.kind ?? 'file') === 'symlink' &&
            currentRelevantPackages.has(m.packageName) &&
            !desiredSymlinkEntries.some((entry) => entry.path === m.path)
          ),
      )
      .map((m) => [m.path, m]),
  );
  for (const e of addedEntries) updatedByPath.set(e.path, e);
  for (const entry of desiredSymlinkEntries) {
    const existingEntry = updatedByPath.get(entry.path);
    if (
      existingEntry &&
      (existingEntry.kind ?? 'file') === 'symlink' &&
      existingEntry.packageName === entry.packageName
    ) {
      continue;
    }
    updatedByPath.set(entry.path, entry);
  }

  const updatedEntries = [...updatedByPath.values()];
  await writeMarker(markerPath(outputDir), updatedEntries);

  if (verbose) {
    console.log(
      `[verbose] updateOutputDirMetadata: ${formatDisplayPath(outputDir, cwd)}: marker updated (${updatedEntries.length} entries)`,
    );
  }

  // Update gitignore: include all remaining managed entries whose gitignore=true
  const resolvedByPath = new Map(
    resolvedFiles.filter((f) => f.outputDir === outputDir).map((f) => [f.relPath, f]),
  );
  const gitignorePaths = updatedEntries
    .filter((e) => (e.kind ?? 'file') !== 'symlink')
    .filter((e) => {
      const resolved = resolvedByPath.get(e.path);
      // For files resolved in this run, honour their gitignore setting.
      // For files from other packages sharing the dir, default to true.
      return resolved ? resolved.gitignore : true;
    })
    .map((e) => e.path);

  await addToGitignore(outputDir, gitignorePaths);
}
