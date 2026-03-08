/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv } from '../../package/argv';
import { printUsage } from '../usage';
import { actionPurge } from '../../package/action-purge';

/**
 * `purge` CLI command handler.
 */
export async function runPurge(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('purge');
    return;
  }

  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const entries = config?.sets ?? [];

  try {
    const summary = await actionPurge({
      entries,
      config,
      cwd,
      presets: parsed.presets ?? [],
      dryRun: parsed.dryRun,
      onProgress: (event: import('../../types').ProgressEvent) => {
        if (parsed.silent) return;
        if (event.type === 'file-deleted') console.log(`  - ${event.file}`);
      },
    });

    console.log(`Purge complete: ${summary.deleted} deleted.`);
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
