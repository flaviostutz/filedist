/* eslint-disable no-restricted-syntax */
import path from 'node:path';

import { NpmdataConfig, NpmdataExtractEntry, ManagedFileMetadata } from '../types';
import { listManagedFiles } from '../fileset/list';

export type ListOptions = {
  entries: NpmdataExtractEntry[];
  config: NpmdataConfig | null;
  cwd: string;
  output?: string;
};

/**
 * Aggregate all managed files across unique output directories.
 * Note: list always ignores --presets; reports all managed files.
 */
export async function actionList(options: ListOptions): Promise<ManagedFileMetadata[]> {
  const { entries, cwd, output } = options;
  const seen = new Set<string>();
  const results: ManagedFileMetadata[] = [];

  // Collect unique output dirs
  const outputDirs: string[] = [];
  if (output) {
    outputDirs.push(path.resolve(cwd, output));
  } else {
    for (const entry of entries) {
      const dir = path.resolve(cwd, entry.output.path);
      if (!seen.has(dir)) {
        seen.add(dir);
        outputDirs.push(dir);
      }
    }
  }

  for (const dir of outputDirs) {
    // eslint-disable-next-line no-await-in-loop
    const files = await listManagedFiles(dir);
    results.push(...files);
  }

  return results;
}
