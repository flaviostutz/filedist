import path from 'node:path';
import fs from 'node:fs';

import { SelectorConfig, ManagedFileMetadata, CheckResult } from '../types';
import { hashFile, hashBuffer, shortenChecksum } from '../utils';

import { enumeratePackageFiles } from './package-files';

/**
 * Check whether locally extracted files are in sync with their source.
 *
 * Uses the checksum stored in each .filedist marker entry to verify file integrity
 * without requiring access to the original source package.
 * Mutable marker entries (extracted with mutable option) are excluded from the check.
 *
 * @param pkgPath       Absolute path to the installed package directory, or null.
 *                      Used only for extra-file detection; not for content comparison.
 * @param outputDir     Absolute path to the output directory.
 * @param selector      SelectorConfig controlling which package files are in scope.
 * @param marker        Managed file entries from the .filedist marker.
 * @returns CheckResult with missing, modified, and extra arrays.
 */
export async function checkFileset(
  pkgPath: string | null,
  outputDir: string,
  marker: ManagedFileMetadata[],
  selector: SelectorConfig = {},
): Promise<CheckResult> {
  const managedByPath = new Map<string, ManagedFileMetadata>(marker.map((m) => [m.path, m]));

  const result: CheckResult = { missing: [], modified: [], extra: [] };

  // Check each managed file
  for (const m of marker) {
    const destPath = path.join(outputDir, m.path);
    if (!fs.existsSync(destPath)) {
      result.missing.push(m.path);
      continue;
    }

    // Mutable files are allowed to change locally; skip content check
    if (m.mutable) continue;

    // Compare local file against stored checksum (no source needed)
    let destHash: string;
    if (m.kind === 'symlink') {
      destHash = shortenChecksum(hashBuffer(fs.readlinkSync(destPath)));
    } else {
      destHash = shortenChecksum(await hashFile(destPath));
    }
    if (m.checksum !== destHash) {
      result.modified.push(m.path);
    }
  }

  // Find extra files: in filtered package source but never extracted (not in marker).
  // Only perform this check when the marker is non-empty and package is available;
  // an empty marker means no extraction has taken place or everything was purged.
  if (pkgPath && marker.length > 0) {
    const pkgFiles = await enumeratePackageFiles(pkgPath, selector);
    for (const relPath of pkgFiles) {
      if (!managedByPath.has(relPath)) {
        result.extra.push(relPath);
      }
    }
  }

  return result;
}
