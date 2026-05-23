/* eslint-disable no-console */
import path from 'node:path';

import { FiledistConfig } from '../../types';
import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { actionInit } from '../../package/action-init';

/**
 * `init` CLI action handler.
 */
export async function runInit(
  config: FiledistConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('init');
    return;
  }

  const parsed = parseArgv(argv);
  const outputDir = parsed.output ? path.resolve(cwd, parsed.output) : cwd;
  const { verbose, files } = parsed;

  // Parse --packages specifically for init (scaffolds the data-package's package.json)
  const packagesIdx = argv.indexOf('--packages');
  const packagesArg =
    packagesIdx !== -1 && packagesIdx + 1 < argv.length ? argv[packagesIdx + 1] : '';
  const packages = packagesArg
    ? packagesArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const initConfig: { files?: string[]; packages?: string[] } = { files };
  if (packages.length > 0) initConfig.packages = packages;

  await actionInit(outputDir, verbose ?? false, initConfig);
  console.log('Init complete. Scaffolded package.json and bin/filedist.js.');
}
