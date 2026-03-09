/* eslint-disable no-console */
import path from 'node:path';

import { NpmdataConfig, NpmdataExtractEntry, ManagedFileMetadata } from '../types';
import { listManagedFiles } from '../fileset/list';

export type ListOptions = {
  entries: NpmdataExtractEntry[];
  config: NpmdataConfig | null;
  cwd: string;
  output?: string;
  verbose?: boolean;
};

/**
 * Aggregate all managed files across unique output directories.
 * Note: list always ignores --presets; reports all managed files.
 */
export async function actionList(options: ListOptions): Promise<ManagedFileMetadata[]> {
  const { entries, cwd, output, verbose = false } = options;
  const seen = new Set<string>();
  const results: ManagedFileMetadata[] = [];

  if (verbose) {
    console.log(
      `[verbose] list: listing managed files across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  // Collect unique output dirs
  const outputDirs: string[] = [];
  if (output) {
    outputDirs.push(path.resolve(cwd, output));
  } else {
    for (const entry of entries) {
      const dir = path.resolve(cwd, entry.output.path);
      if (!seen.has(dir)) {
        seen.add(dir);
        if (verbose) {
          console.log(`[verbose] list: scanning directory ${dir}`);
        }
        outputDirs.push(dir);
      }
    }
  }

  for (const dir of outputDirs) {
    const files = await listManagedFiles(dir);
    results.push(...files);
  }

  return results;
}
