import { ManagedFileMetadata } from '../types';

import { readManagedFilesForDir } from './lockfile';

export type ListOptions = {
  cwd: string;
  outputDir: string;
  verbose?: boolean;
  /** Absolute path to the lock file. */
  lockfilePath: string;
};

/**
 * List all managed files for an output directory from the central lock file.
 * Note: list always ignores --presets; reports all managed files.
 */
export function actionList(options: ListOptions): ManagedFileMetadata[] {
  const { lockfilePath, cwd, outputDir } = options;
  return readManagedFilesForDir(lockfilePath, cwd, outputDir);
}
