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
import {
  readLockfile,
  writeLockfile,
  buildLockfileData,
  readManagedFilesForDir,
  outputDirKey,
  LOCKFILE_NAME,
} from './lockfile';

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
 *  - Without frozenLockfile (and CI env not set): resolve with latest package versions,
 *    then write/update .filedist.lock (packages + sets + managed files).
 *  - With frozenLockfile (or when process.env.CI is set): read .filedist.lock (error if
 *    missing), use pinned versions and set definitions from lockfile, validate that the
 *    resolved managed-files list matches the lockfile — fail on any difference.
 */
function mergePackagesFromLockfile(
  cwd: string,
  relevantPackagesByOutputDir: Map<string, Set<string>>,
  managedFiles: Record<string, string[]>,
): void {
  for (const [relKey, lines] of Object.entries(managedFiles)) {
    const outputDir = path.resolve(cwd, relKey);
    const existing = relevantPackagesByOutputDir.get(outputDir) ?? new Set<string>();
    for (const line of lines) {
      const pkg = line.split('|')[1];
      if (pkg) existing.add(pkg);
    }
    relevantPackagesByOutputDir.set(outputDir, existing);
  }
}

// eslint-disable-next-line complexity
export async function actionInstall(options: InstallOptions): Promise<InstallResult> {
  const { cwd, verbose = false, onProgress, dryRun, entries: configEntries } = options;
  // Auto-enable frozen lockfile in CI environments
  const frozenLockfile = options.frozenLockfile ?? (!!process.env.CI && process.env.CI !== 'false');
  const sourceRuntime = createSourceRuntime(cwd, verbose);

  // ── Lock file handling — resolve locked versions and entries before resolution phase ────
  let lockedVersions: Map<string, string> | undefined;
  let entries = configEntries;
  if (frozenLockfile) {
    const lockfileData = readLockfile(cwd);
    if (!lockfileData) {
      throw new Error(
        `Lock file ${LOCKFILE_NAME} not found. ` +
          `Run 'filedist install' without --frozen-lockfile first.`,
      );
    }
    lockedVersions = new Map(
      Object.entries(lockfileData.packages).map(([spec, entry]) => [spec, entry.ref]),
    );
    // Use set definitions from lockfile if available
    if (lockfileData.sets && lockfileData.sets.length > 0) {
      entries = lockfileData.sets;
      if (verbose) {
        console.log(
          `[verbose] actionInstall: frozen mode — using ${entries.length} set(s) from lock file`,
        );
      }
    }
    if (verbose) {
      console.log(
        `[verbose] actionInstall: using frozen lock file (${lockedVersions.size} package(s))`,
      );
    }
  }

  const isDryRun = dryRun ?? entries.some((e) => e.output?.dryRun === true);
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

    // ── Supplement output dirs from lockfile for orphan cleanup ──────────────
    // When entries shrink (e.g. after `remove`), output directories that were
    // previously managed may no longer be fully referenced by the current entries.
    // Merge all packages from the lockfile's managed_files into
    // relevantPackagesByOutputDir so calculateDiff identifies files from removed
    // packages as "extra" and cleans them up. Skip in frozen mode.
    if (!frozenLockfile) {
      const existingLock = readLockfile(cwd);
      if (existingLock?.managed_files) {
        mergePackagesFromLockfile(cwd, relevantPackagesByOutputDir, existingLock.managed_files);
      }
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

    // ── Frozen managed-files validation ───────────────────────────────────
    // In frozen mode the managed files list must not change. Fail early if the
    // desired file set differs from what is recorded in the lock file.
    if (frozenLockfile && !isDryRun) {
      const frozenLockData = readLockfile(cwd);
      if (frozenLockData?.managed_files) {
        const outputDirs = new Set<string>([
          ...resolvedFiles.map((f) => f.outputDir),
          ...relevantPackagesByOutputDir.keys(),
        ]);
        for (const outputDir of outputDirs) {
          validateFrozenManagedFiles(cwd, outputDir, resolvedFiles, frozenLockData.managed_files);
        }
      }
    }

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
    const managedFilesByOutputDir = new Map<string, ManagedFileMetadata[]>();
    for (const outputDir of outputDirs) {
      const dirFiles = resolvedFiles.filter((f) => f.outputDir === outputDir);
      const relevantPackages = relevantPackagesByOutputDir.get(outputDir);
      const existingMarker = readManagedFilesForDir(cwd, outputDir);
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

      const updatedEntries = await updateOutputDirMetadata(
        outputDir,
        diff,
        dirFiles,
        desiredSymlinkEntries,
        relevantPackages,
        noSyncOutputDirs.has(outputDir),
        cwd,
        verbose,
      );
      managedFilesByOutputDir.set(outputDir, updatedEntries);
    }

    if (verbose) {
      console.log(
        `[verbose] actionInstall: complete — added=${result.added} modified=${result.modified}` +
          ` deleted=${result.deleted} skipped=${result.skipped}`,
      );
    }

    // ── Write/update lock file ───────────────────────────────────────────────
    // Skip all lock file writes when dry-run or frozen.
    if (!isDryRun && !frozenLockfile) {
      const existingLock = readLockfile(cwd) ?? { lockfileVersion: 1, packages: {} };
      const managedFilesMap: Record<string, string[]> = {};
      for (const [outputDir, entries] of managedFilesByOutputDir) {
        if (entries.length > 0) {
          const key = outputDirKey(cwd, outputDir);
          // Serialize using the same format as lockfile helpers
          managedFilesMap[key] = serializeManagedEntries(entries);
        }
      }
      const { packages } = buildLockfileData(resolvedPackages);
      const updatedLock = {
        ...existingLock,
        packages,
        // Store the set definitions so check/purge/frozen-install can operate without config
        sets: configEntries,
        // Always override managed_files with the freshly computed map so entries
        // from removed sets are not carried over from the existingLock spread.
        // writeLockfile deletes the key when the map is empty.
        // eslint-disable-next-line camelcase
        managed_files: managedFilesMap,
      };
      writeLockfile(cwd, updatedLock);
      if (verbose) {
        const pkgCount = Object.keys(updatedLock.packages).length;
        const dirCount = Object.keys(managedFilesMap).length;
        console.log(
          `[verbose] actionInstall: lock file updated (${pkgCount} package(s), ` +
            `${updatedLock.sets?.length ?? 0} set(s), ${dirCount} managed dir(s))`,
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

/** Serialize ManagedFileMetadata entries to pipe-separated strings for the lock file. */
function serializeManagedEntries(entries: ManagedFileMetadata[]): string[] {
  return entries.map((e) => {
    const kindField = e.kind === 'symlink' ? 'symlink' : 'file';
    const checksumField = e.checksum;
    const mutableField = e.mutable ? '1' : '0';
    return `${e.path}|${e.packageName}|${e.packageVersion}|${kindField}|${checksumField}|${mutableField}`;
  });
}

/**
 * Update managed file metadata and .gitignore for one output directory after
 * disk changes have been applied. Returns the updated entries (to be stored
 * in .filedist.lock by the caller).
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
): Promise<ManagedFileMetadata[]> {
  const existingMarker = readManagedFilesForDir(cwd, outputDir);

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
          checksum: checksumValue,
          mutable: e.desired!.mutable,
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
          checksum: checksumValue,
          mutable: e.desired!.mutable,
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
            m.kind === 'symlink' &&
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
      existingEntry.kind === 'symlink' &&
      existingEntry.packageName === entry.packageName
    ) {
      continue;
    }
    updatedByPath.set(entry.path, entry);
  }

  const updatedEntries = [...updatedByPath.values()];

  if (verbose) {
    console.log(
      `[verbose] updateOutputDirMetadata: ${formatDisplayPath(outputDir, cwd)}: marker prepared (${updatedEntries.length} entries)`,
    );
  }

  // Update gitignore: include all remaining managed entries whose gitignore=true
  const resolvedByPath = new Map(
    resolvedFiles.filter((f) => f.outputDir === outputDir).map((f) => [f.relPath, f]),
  );
  const gitignorePaths = updatedEntries
    .filter((e) => e.kind !== 'symlink')
    .filter((e) => {
      const resolved = resolvedByPath.get(e.path);
      // For files resolved in this run, honour their gitignore setting.
      // For files from other packages sharing the dir, default to true.
      return resolved ? resolved.gitignore : true;
    })
    .map((e) => e.path);

  await addToGitignore(outputDir, gitignorePaths);
  return updatedEntries;
}

/**
 * Validate that the desired managed-file paths for an output directory match
 * what is recorded in the lock file's managed_files map.
 * Throws a descriptive error when files have been added or removed.
 */
function validateFrozenManagedFiles(
  cwd: string,
  outputDir: string,
  resolvedFiles: ResolvedFile[],
  managedFilesRecord: Record<string, string[]>,
): void {
  const key = outputDirKey(cwd, outputDir);
  const lockedPaths = new Set<string>();
  for (const line of managedFilesRecord[key] ?? []) {
    const relPath = line.split('|')[0];
    if (relPath) lockedPaths.add(relPath);
  }
  const desiredPaths = new Set(
    resolvedFiles.filter((f) => f.outputDir === outputDir && f.managed).map((f) => f.relPath),
  );
  const missingInLock = [...desiredPaths].filter((p) => !lockedPaths.has(p));
  const extraInLock = [...lockedPaths].filter((p) => !desiredPaths.has(p));
  if (missingInLock.length > 0 || extraInLock.length > 0) {
    throw new Error(
      `Frozen lockfile violation: managed file list changed for "${key}".\n` +
        (missingInLock.length > 0 ? `  New files not in lock: ${missingInLock.join(', ')}\n` : '') +
        (extraInLock.length > 0 ? `  Files removed from source: ${extraInLock.join(', ')}\n` : '') +
        `Run 'filedist install' without --frozen-lockfile to update the lock file.`,
    );
  }
}
