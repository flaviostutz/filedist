/* eslint-disable no-console */
import path from 'node:path';

import { NpmdataConfig, NpmdataExtractEntry, ProgressEvent } from '../types';
import { parsePackageSpec, filterEntriesByPresets } from '../utils';
import { readOutputDirMarker } from '../fileset/markers';
import { purgeFileset } from '../fileset/purge';

export type PurgeOptions = {
  entries: NpmdataExtractEntry[];
  config: NpmdataConfig | null;
  cwd: string;
  presets?: string[];
  dryRun?: boolean;
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
};

export type PurgeSummary = {
  deleted: number;
  symlinksRemoved: number;
  dirsRemoved: number;
};

/**
 * Purge managed files from all matching filesets.
 * Supports --presets filtering and --dry-run.
 */
export async function actionPurge(options: PurgeOptions): Promise<PurgeSummary> {
  const { entries, cwd, presets = [], dryRun = false, verbose = false, onProgress } = options;

  if (verbose) {
    console.log(
      `[verbose] purge: processing ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  const summary: PurgeSummary = { deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 };

  // Filter by presets
  const filtered = filterEntriesByPresets(entries, presets);

  for (const entry of filtered) {
    const pkg = parsePackageSpec(entry.package);
    const outputDir = path.resolve(cwd, entry.output.path);

    if (verbose) {
      console.log(`[verbose] purge: entry package=${entry.package} outputDir=${entry.output.path}`);
    }

    onProgress?.({
      type: 'package-start',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Read managed files for this entry

    const managedFiles = await readOutputDirMarker(outputDir);

    // Purge only files belonging to this package
    const entryFiles = managedFiles.filter((m) => m.packageName === pkg.name);

    const result = await purgeFileset(outputDir, entryFiles, dryRun);

    for (const m of entryFiles) {
      onProgress?.({ type: 'file-deleted', packageName: pkg.name, file: m.path });
    }

    summary.deleted += result.deleted;
    summary.symlinksRemoved += result.symlinksRemoved;
    summary.dirsRemoved += result.dirsRemoved;

    if (verbose) {
      console.log(
        `[verbose] purge: deleted ${result.deleted} files, ${result.symlinksRemoved} symlinks, ${result.dirsRemoved} dirs for ${entry.package}`,
      );
    }

    onProgress?.({
      type: 'package-end',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });
  }

  return summary;
}
