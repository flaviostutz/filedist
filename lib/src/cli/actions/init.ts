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

  // Parse --package-config: config filename to embed in the generated bin shim
  const pkgConfigIdx = argv.indexOf('--package-config');
  let baseConfigFile: string | undefined;
  if (pkgConfigIdx !== -1 && pkgConfigIdx + 1 < argv.length) {
    baseConfigFile = argv[pkgConfigIdx + 1];
  }

  const initConfig: { files?: string[]; baseConfigFile?: string } = {
    files,
  };
  if (baseConfigFile) initConfig.baseConfigFile = baseConfigFile;

  await actionInit(outputDir, verbose ?? false, initConfig);
  console.log(
    'Init complete. Scaffolded package.json, .filedist-package.yml, and bin/filedist.js.',
  );
}
