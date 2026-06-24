/* eslint-disable no-console */

import { FiledistConfig, ProgressEvent } from '../../types';
import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionUpdate } from '../../package/action-update';

/**
 * `update` CLI action handler.
 *
 * Reads set definitions from the current config (preferred) or .filedist.lock
 * (fallback when no config), bumps all packages to their latest available
 * versions, runs a full install and writes an updated lockfile.
 */
export async function runUpdate(
  config: FiledistConfig | null,
  argv: string[],
  cwd: string,
  lockfilePath: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('update');
    return;
  }

  const parsed = parseArgv(argv);

  // Prefer entries from the current config so that sets added since the last
  // install are picked up. actionUpdate falls back to .filedist.lock entries
  // when entries is undefined (e.g. when no config file is found).
  // eslint-disable-next-line no-undefined
  const entries = config?.sets && config.sets.length > 0 ? config.sets : undefined;

  const result = await actionUpdate({
    entries,
    cwd,
    verbose: parsed.verbose,
    dryRun: parsed.dryRun,
    // Forward --upgrade=false when explicitly set; default (upgrade=true) bumps to latest.
    upgrade: parsed.upgrade !== false,
    lockfilePath,
    onProgress: (event: ProgressEvent) => {
      if (parsed.silent) return;
      if (event.type === 'file-added') console.log(`  + ${formatProgressFile(event)}`);
      else if (event.type === 'file-modified') console.log(`  ~ ${formatProgressFile(event)}`);
      else if (event.type === 'file-deleted') console.log(`  - ${formatProgressFile(event)}`);
    },
  });

  console.log(
    `Update complete: ${result.added} added, ${result.modified} modified, ` +
      `${result.deleted} deleted, ${result.skipped} skipped.`,
  );
}
