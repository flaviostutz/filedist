/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import { ResolvedFile, DiffResult, ManagedFileMetadata } from '../types';
import { readManagedGitignoreEntries } from '../fileset/gitignore';
import { hashFile, hashBuffer, formatDisplayPath } from '../utils';
import { readOutputDirMarker } from '../fileset/markers';

import { applyContentReplacementsToBuffer } from './content-replacements';

/**
 * Calculate the diff between the desired file list (from resolveFiles) and the
 * actual state of each output directory.
 *
 * Only managed files (tracked in .npmdata markers) are included in the 'extra'
 * analysis, scoped to the packages represented in `resolvedFiles`.
 *
 * @returns DiffResult classifying each file as ok, missing, extra, or conflict.
 */
export async function calculateDiff(
  resolvedFiles: ResolvedFile[],
  verbose?: boolean,
  cwd?: string,
  relevantPackagesByOutputDir?: Map<string, Set<string>>,
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
): Promise<void> {
  const existingMarker = await readOutputDirMarker(outputDir);
  const managedByPath = new Map<string, ManagedFileMetadata>(
    existingMarker.map((m) => [m.path, m]),
  );
  const desiredByPath = new Map<string, ResolvedFile>(desiredFiles.map((f) => [f.relPath, f]));
  const gitignorePaths = readManagedGitignoreEntries(outputDir);
  const outputRelevantPackages =
    relevantPackages ?? new Set(desiredFiles.map((f) => f.packageName));

  for (const desired of desiredFiles) {
    await classifyDesiredFile(desired, outputDir, managedByPath, gitignorePaths, result);
  }

  for (const markerEntry of existingMarker) {
    if (
      outputRelevantPackages.has(markerEntry.packageName) &&
      !desiredByPath.has(markerEntry.path)
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

/**
 * Classify a single desired file against the current output directory state.
 * Appends to the appropriate result bucket (ok, missing, or conflict).
 */
async function classifyDesiredFile(
  desired: ResolvedFile,
  outputDir: string,
  managedByPath: Map<string, ManagedFileMetadata>,
  gitignorePaths: Set<string>,
  result: DiffResult,
): Promise<void> {
  const destPath = path.join(outputDir, desired.relPath);
  const destExists = fs.existsSync(destPath);

  if (!destExists) {
    result.missing.push({ status: 'missing', relPath: desired.relPath, outputDir, desired });
    return;
  }

  const conflictReasons: Array<'content' | 'managed' | 'gitignore'> = [];

  // Content check
  let srcHash: string;
  try {
    if (desired.contentReplacements.length > 0) {
      const srcContent = fs.readFileSync(desired.sourcePath, 'utf8');
      const transformed = applyContentReplacementsToBuffer(srcContent, desired.contentReplacements);
      srcHash = hashBuffer(transformed);
    } else {
      srcHash = await hashFile(desired.sourcePath);
    }
  } catch {
    srcHash = await hashFile(desired.sourcePath);
  }
  const destHash = await hashFile(destPath);
  if (srcHash !== destHash) conflictReasons.push('content');

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
      existing: managedByPath.get(desired.relPath),
    });
  } else {
    result.conflict.push({
      status: 'conflict',
      relPath: desired.relPath,
      outputDir,
      desired,
      existing: managedByPath.get(desired.relPath),
      conflictReasons,
    });
  }
}
