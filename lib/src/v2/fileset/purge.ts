/* eslint-disable no-restricted-syntax */
/* eslint-disable functional/no-try-statements */
import fs from 'node:fs';
import path from 'node:path';

import { ManagedFileMetadata, PurgeResult } from '../types';
import { removeAllSymlinks } from '../package/symlinks';

import { markerPath } from './markers';
import { removeFromGitignore } from './gitignore';
import { MARKER_FILE } from './constants';

/**
 * Purge all managed files in entries from the output directory.
 * Also removes symlinks, empty directories, marker file, and gitignore entries.
 *
 * @param outputDir   Absolute path to the output directory.
 * @param entries     List of managed file entries to remove.
 * @param dryRun      If true, only report what would be removed without deleting.
 * @returns PurgeResult with counts of deleted, symlinks removed, and dirs removed.
 */
export async function purgeFileset(
  outputDir: string,
  entries: ManagedFileMetadata[],
  dryRun: boolean,
): Promise<PurgeResult> {
  const result: PurgeResult = { deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 };

  if (!fs.existsSync(outputDir)) return result;

  // 1. Delete managed files
  for (const entry of entries) {
    const fullPath = path.join(outputDir, entry.path);
    if (fs.existsSync(fullPath)) {
      if (!dryRun) {
        try {
          fs.chmodSync(fullPath, 0o644);
          fs.unlinkSync(fullPath);
        } catch {
          // ignore
        }
      }
      result.deleted += 1;
    }
  }

  if (!dryRun) {
    // 2. Remove all symlinks pointing into outputDir
    result.symlinksRemoved = await removeAllSymlinks(outputDir);

    // 3. Remove empty directories bottom-up
    result.dirsRemoved = removeEmptyDirs(outputDir);

    // 4. Remove or update .npmdata marker
    const marker = markerPath(outputDir);
    if (fs.existsSync(marker)) {
      try {
        fs.chmodSync(marker, 0o644);
        fs.unlinkSync(marker);
      } catch {
        // ignore
      }
    }

    // 5. Remove gitignore entries
    const removedPaths = entries.map((e) => e.path);
    await removeFromGitignore(outputDir, removedPaths);
  }

  return result;
}

/**
 * Remove empty directories bottom-up within the given directory.
 * Returns count of directories removed.
 */
function removeEmptyDirs(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return count;

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink() || entry === MARKER_FILE) continue;
    if (stat.isDirectory()) {
      count += removeEmptyDirs(fullPath);
      // Try to remove dir if now empty
      try {
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
          count += 1;
        }
      } catch {
        // ignore
      }
    }
  }
  return count;
}
