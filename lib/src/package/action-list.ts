import { readOutputDirMarker } from '../fileset';
import { ManagedFileMetadata } from '../types';

export type ListOptions = {
  outputDir: string;
  verbose?: boolean;
};

/**
 * Aggregate all managed files across unique output directories.
 * Note: list always ignores --presets; reports all managed files.
 */
export async function actionList(options: ListOptions): Promise<ManagedFileMetadata[]> {
  return readOutputDirMarker(options.outputDir);
}
