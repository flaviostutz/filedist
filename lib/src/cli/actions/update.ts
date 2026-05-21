/* eslint-disable no-console */

import { FiledistConfig, ProgressEvent } from '../../types';
import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionUpdate } from '../../package/action-update';

/**
 * `update` CLI action handler.
 *
 * Reads set definitions from .filedist.lock, bumps all packages to their
 * latest available versions, runs a full install and writes an updated lockfile.
 */
export async function runUpdate(
  config: FiledistConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('update');
    return;
  }

  const parsed = parseArgv(argv);

  const result = await actionUpdate({
    cwd,
    verbose: parsed.verbose,
    dryRun: parsed.dryRun,
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
