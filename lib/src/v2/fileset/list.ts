import { ManagedFileMetadata } from '../types';

import { readOutputDirMarker } from './markers';

/**
 * Read all managed files from a single output directory's .npmdata marker.
 */
export async function listManagedFiles(outputDir: string): Promise<ManagedFileMetadata[]> {
  return readOutputDirMarker(outputDir);
}
