/* eslint-disable no-console */
import { BasicPackageOptions, FiledistExtractEntry, ProgressEvent } from '../types';

import { actionInstall, InstallResult } from './action-install';
import { readLockfile } from './lockfile';

export type UpdateOptions = Omit<BasicPackageOptions, 'entries'> & {
  entries?: FiledistExtractEntry[];
  onProgress?: (event: ProgressEvent) => void;
  /**
   * Absolute path to the lock file. Derived from the config file path via getLockfilePath().
   */
  lockfilePath: string;
  /**
   * When true (default), forces every entry selector to upgrade=true so the
   * package manager fetches the latest matching version from the registry.
   * Set to false to re-resolve from whatever is currently installed locally
   * (useful for testing without registry access).
   */
  upgrade?: boolean;
};

/**
 * Update managed files to their latest available package versions.
 *
 * Reads the set definitions from .filedist.lock (falls back to the entries option
 * when no lockfile is present). Forces upgrade=true on every entry selector so
 * npm/git sources are re-fetched for the newest matching version. Then runs a
 * full install (frozenLockfile=false), which resolves and writes an updated
 * lockfile with new package refs, updated sets, and an updated managed files list.
 */
export async function actionUpdate(options: UpdateOptions): Promise<InstallResult> {
  const { cwd, verbose = false, onProgress, dryRun, upgrade = true } = options;
  const { lockfilePath } = options;

  const lockfileData = readLockfile(lockfilePath);

  // Prefer caller-supplied entries (user config) — same precedence as actionInstall.
  // Fall back to set definitions recorded in .filedist.lock when no entries are provided.
  let entries: FiledistExtractEntry[] =
    (options.entries && options.entries.length > 0 ? options.entries : lockfileData?.sets) ?? [];

  if (entries.length === 0) {
    throw new Error(
      `No sets found. Run 'filedist install' first, or provide --packages to specify packages.`,
    );
  }

  // Force upgrade on all selectors so the resolver fetches the newest matching version.
  if (upgrade) {
    entries = entries.map((entry) => ({
      ...entry,
      selector: { ...entry.selector, upgrade: true },
    }));
  }

  if (verbose) {
    console.log(
      `[verbose] actionUpdate: bumping ${entries.length} set(s) to latest package versions`,
    );
  }

  return actionInstall({
    entries,
    cwd,
    verbose,
    dryRun,
    onProgress,
    lockfilePath,
    frozenLockfile: false,
  });
}
