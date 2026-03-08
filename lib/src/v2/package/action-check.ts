/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */

import path from 'node:path';

import { NpmdataConfig, NpmdataExtractEntry, ProgressEvent } from '../types';
import { parsePackageSpec, getInstalledPackagePath } from '../utils';
import { readOutputDirMarker } from '../fileset/markers';
import { checkFileset } from '../fileset/check';

export type CheckOptions = {
  entries: NpmdataExtractEntry[];
  config: NpmdataConfig | null;
  cwd: string;
  onProgress?: (event: ProgressEvent) => void;
  skipUnmanaged?: boolean;
};

export type CheckSummary = {
  missing: string[];
  modified: string[];
  extra: string[];
};

/**
 * Orchestrate check across all filesets, filtering out unmanaged entries.
 * Returns a summary of all drift found across all entries.
 */
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const { entries, cwd, onProgress, skipUnmanaged } = options;
  const summary: CheckSummary = { missing: [], modified: [], extra: [] };

  for (const entry of entries) {
    // Skip unmanaged entries (no marker written, nothing to check)
    if (entry.output.unmanaged && skipUnmanaged) continue;

    const pkg = parsePackageSpec(entry.package);
    const outputDir = path.resolve(cwd, entry.output.path);

    onProgress?.({
      type: 'package-start',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Check if package is installed
    const pkgPath = getInstalledPackagePath(pkg.name, cwd);

    // Read existing marker
    // eslint-disable-next-line no-await-in-loop
    const existingMarker = await readOutputDirMarker(outputDir);

    if (!pkgPath) {
      console.error(`Package ${pkg.name} is not installed. Run 'extract' first.`);
      summary.missing.push(...existingMarker.map((m) => m.path));
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await checkFileset(
      pkgPath,
      outputDir,
      entry.selector ?? {},
      entry.output,
      existingMarker,
    );

    summary.missing.push(...result.missing);
    summary.modified.push(...result.modified);
    summary.extra.push(...result.extra);

    onProgress?.({
      type: 'package-end',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });
  }

  return summary;
}
