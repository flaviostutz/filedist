import fs from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { ContentReplacementConfig } from '../types';
import { isBinaryFile } from '../utils';

/**
 * Apply content replacement rules to an in-memory string (pure function).
 * Used during check comparison to apply the same transformations before hashing,
 * so replaced files are not falsely reported as modified.
 *
 * @param content The file content as a string.
 * @param replacements List of ContentReplacementConfig to apply.
 * @returns Transformed content string.
 */
export function applyContentReplacementsToBuffer(
  content: string,
  replacements: ContentReplacementConfig[],
): string {
  let result = content;
  for (const replacement of replacements) {
    const regex = new RegExp(replacement.match, 'g');
    result = result.replace(regex, replacement.replace);
  }
  return result;
}

/**
 * Apply content replacement rules to files on disk matching the given glob patterns.
 * Skips binary files.
 *
 * @param files   List of absolute file paths to apply replacements to.
 *                Pre-resolved by the caller via glob matching.
 * @param replacements List of ContentReplacementConfig to apply.
 */
export async function applyContentReplacements(
  cwd: string,
  replacements: ContentReplacementConfig[],
): Promise<void> {
  if (replacements.length === 0) return;

  // Find all files matching any replacement's files glob under cwd
  const allFiles = collectFilesForReplacements(cwd, replacements);

  for (const filePath of allFiles) {
    if (isBinaryFile(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const transformed = applyContentReplacementsToBuffer(content, replacements);
      if (transformed !== content) {
        // Make writable, write, restore writability status
        const stat = fs.statSync(filePath);

        const wasReadOnly = (stat.mode & 0o200) === 0;
        if (wasReadOnly) fs.chmodSync(filePath, 0o644);
        fs.writeFileSync(filePath, transformed, 'utf8');
        if (wasReadOnly) fs.chmodSync(filePath, 0o444);
      }
    } catch {
      // Skip unreadable files
    }
  }
}

/**
 * Collect all files under cwd matching at least one replacement's files glob.
 */
function collectFilesForReplacements(
  cwd: string,
  replacements: ContentReplacementConfig[],
): string[] {
  const globs = replacements.map((r) => r.files);
  const results: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const relPath = path.relative(cwd, fullPath);
      if (globs.some((glob) => minimatch(relPath, glob, { dot: true }))) {
        results.push(fullPath);
      }
    }
  };

  try {
    walk(cwd);
  } catch {
    // ignore
  }
  return results;
}
