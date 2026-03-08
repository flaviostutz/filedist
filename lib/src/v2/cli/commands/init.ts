/* eslint-disable no-console */
import path from 'node:path';

import { NpmdataConfig } from '../../types';
import { parseArgv } from '../../package/argv';
import { printUsage } from '../usage';
import { actionInit } from '../../package/action-init';

/**
 * `init` CLI command handler.
 */
export async function runInit(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('init');
    return;
  }

  const parsed = parseArgv(argv);
  const outputDir = parsed.output ? path.resolve(cwd, parsed.output) : cwd;
  const { verbose } = parsed;

  try {
    await actionInit(outputDir, verbose);
    console.log('Init complete. Scaffolded package.json and bin/npmdata.js.');
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
