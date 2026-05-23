/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ResolvedFile, DiffResult, ManagedFileMetadata } from '../types';
import { readManagedGitignoreEntries } from '../fileset/gitignore';
import { hashFile, isBinaryFile, formatDisplayPath, shortenChecksum } from '../utils';

import { readManagedFilesForDir } from './lockfile';
import { applyContentReplacementsToBuffer } from './content-replacements';
import { collectManagedSymlinkTargets } from './symlinks';

/**
 * Calculate the diff between the desired file list (from resolveFiles) and the
 * actual state of each output directory.
 *
 * Only managed files (tracked in .filedist markers) are included in the 'extra'
 * analysis, scoped to the packages represented in `resolvedFiles`.
 *
 * @returns DiffResult classifying each file as ok, missing, extra, or conflict.
 */
export async function calculateDiff(
  resolvedFiles: ResolvedFile[],
  verbose?: boolean,
  cwd?: string,
  relevantPackagesByOutputDir?: Map<string, Set<string>>,
  compareWithSource?: boolean,
  lockfilePath?: string,
): Promise<DiffResult> {
  const result: DiffResult = { ok: [], missing: [], extra: [], conflict: [] };

  if (
    resolvedFiles.length === 0 &&
    (!relevantPackagesByOutputDir || relevantPackagesByOutputDir.size === 0)
  ) {
    return result;
  }

  // Group resolved files by output directory
  const byOutputDir = new Map<string, ResolvedFile[]>();
  for (const f of resolvedFiles) {
    const arr = byOutputDir.get(f.outputDir) ?? [];
    arr.push(f);
    byOutputDir.set(f.outputDir, arr);
  }

  const outputDirs = new Set<string>([
    ...byOutputDir.keys(),
    ...(relevantPackagesByOutputDir?.keys() ?? []),
  ]);

  for (const outputDir of outputDirs) {
    await appendOutputDirDiff(
      outputDir,
      byOutputDir.get(outputDir) ?? [],
      result,
      relevantPackagesByOutputDir?.get(outputDir),
      compareWithSource,
      cwd,
      lockfilePath,
    );

    if (verbose) {
      console.log(
        `[verbose] calculateDiff: ${formatDisplayPath(outputDir, cwd)}: ` +
          `ok=${result.ok.length} missing=${result.missing.length} ` +
          `conflict=${result.conflict.length} extra=${result.extra.length}`,
      );
    }
  }

  return result;
}

async function appendOutputDirDiff(
  outputDir: string,
  desiredFiles: ResolvedFile[],
  result: DiffResult,
  relevantPackages?: Set<string>,
  compareWithSource?: boolean,
  cwd?: string,
  lockfilePath?: string,
): Promise<void> {
  let existingMarker: ManagedFileMetadata[] = [];
  if (lockfilePath && cwd) {
    existingMarker = readManagedFilesForDir(lockfilePath, cwd, outputDir);
  }
  const managedByPath = new Map<string, ManagedFileMetadata>(
    existingMarker.map((m) => [m.path, m]),
  );
  const desiredSymlinks = collectManagedSymlinkTargets(outputDir, desiredFiles);
  const desiredPaths = new Set<string>([
    ...desiredFiles.map((file) => file.relPath),
    ...desiredSymlinks.map((entry) => entry.path),
  ]);
  const gitignorePaths = readManagedGitignoreEntries(outputDir);
  const outputRelevantPackages =
    relevantPackages ?? new Set(desiredFiles.map((f) => f.packageName));

  for (const desired of desiredFiles) {
    await classifyDesiredFile(
      desired,
      outputDir,
      managedByPath,
      gitignorePaths,
      result,
      compareWithSource,
    );
  }

  for (const desiredSymlink of desiredSymlinks) {
    classifyDesiredSymlink(desiredSymlink, outputDir, managedByPath, result);
  }

  for (const markerEntry of existingMarker) {
    if (
      outputRelevantPackages.has(markerEntry.packageName) &&
      !desiredPaths.has(markerEntry.path)
    ) {
      result.extra.push({
        status: 'extra',
        relPath: markerEntry.path,
        outputDir,
        existing: markerEntry,
      });
    }
  }
}

function classifyDesiredSymlink(
  desiredSymlink: ReturnType<typeof collectManagedSymlinkTargets>[number],
  outputDir: string,
  managedByPath: Map<string, ManagedFileMetadata>,
  result: DiffResult,
): void {
  const linkPath = path.join(outputDir, desiredSymlink.path);
  const existingEntry = managedByPath.get(desiredSymlink.path);

  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    result.missing.push({ status: 'missing', relPath: desiredSymlink.path, outputDir });
    return;
  }

  const conflictReasons: Array<'content' | 'managed' | 'gitignore'> = [];
  if (!stat.isSymbolicLink()) {
    conflictReasons.push('content');
  } else {
    const actualTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    if (actualTarget !== desiredSymlink.targetPath) {
      conflictReasons.push('content');
    }
  }

  if (!existingEntry || existingEntry.kind !== 'symlink') {
    conflictReasons.push('managed');
  }

  if (conflictReasons.length === 0) {
    result.ok.push({
      status: 'ok',
      relPath: desiredSymlink.path,
      outputDir,
      existing: existingEntry,
    });
  } else {
    result.conflict.push({
      status: 'conflict',
      relPath: desiredSymlink.path,
      outputDir,
      existing: existingEntry,
      conflictReasons,
    });
  }
}

/**
 * Classify a single desired file against the current output directory state.
 * Appends to the appropriate result bucket (ok, missing, or conflict).
 *
 * When compareWithSource=true (used by action-extract), content is compared
 * against the package source (with content replacements applied). This detects
 * when the package has been updated since the last extraction.
 *
 * When compareWithSource=false (used by action-check), content is compared
 * against the stored checksum in the marker. This detects tampering without
 * requiring access to the source package.
 */
async function classifyDesiredFile(
  desired: ResolvedFile,
  outputDir: string,
  managedByPath: Map<string, ManagedFileMetadata>,
  gitignorePaths: Set<string>,
  result: DiffResult,
  compareWithSource?: boolean,
): Promise<void> {
  const destPath = path.join(outputDir, desired.relPath);
  const destExists = fs.existsSync(destPath);

  if (!destExists) {
    result.missing.push({ status: 'missing', relPath: desired.relPath, outputDir, desired });
    return;
  }

  const conflictReasons: Array<'content' | 'managed' | 'gitignore'> = [];
  const existingEntry = managedByPath.get(desired.relPath);

  if (compareWithSource) {
    // Extraction mode: compare disk against package source (with replacements).
    // Mutable files are allowed to diverge from source — skip content check.
    if (!existingEntry?.mutable) {
      const sourceHash = await hashSrcWithReplacements(
        desired.sourcePath,
        desired.contentReplacements,
      );
      const destHash = await hashFile(destPath);
      if (sourceHash !== destHash) conflictReasons.push('content');
    }
  } else {
    // Check mode: compare disk against stored checksum (no source package needed).
    // Mutable files are allowed to change locally — skip content verification.
    if (existingEntry?.mutable) {
      // File is intentionally mutable (e.g. extracted with mutable option); skip content check
    } else {
      const destHash = shortenChecksum(await hashFile(destPath));
      if (existingEntry?.checksum !== destHash) conflictReasons.push('content');
    }
  }

  // Managed-state check
  const isManaged = managedByPath.has(desired.relPath);
  if (desired.managed !== isManaged) conflictReasons.push('managed');

  // Gitignore-state check
  const isGitignored = gitignorePaths.has(desired.relPath);
  if (desired.gitignore !== isGitignored) conflictReasons.push('gitignore');

  if (conflictReasons.length === 0) {
    result.ok.push({
      status: 'ok',
      relPath: desired.relPath,
      outputDir,
      desired,
      existing: existingEntry,
    });
  } else {
    result.conflict.push({
      status: 'conflict',
      relPath: desired.relPath,
      outputDir,
      desired,
      existing: existingEntry,
      conflictReasons,
    });
  }
}

/**
 * Hash a source file with content replacements applied in-memory.
 * Used in extraction mode so the comparison is against what will be written to disk.
 */
async function hashSrcWithReplacements(
  srcPath: string,
  contentReplacements: import('../types').ContentReplacementConfig[],
): Promise<string> {
  if (contentReplacements.length === 0 || isBinaryFile(srcPath)) return hashFile(srcPath);
  const content = fs.readFileSync(srcPath, 'utf8');
  const transformed = applyContentReplacementsToBuffer(content, contentReplacements);
  return crypto.createHash('sha256').update(transformed).digest('hex');
}
