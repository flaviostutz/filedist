/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { detect } from 'package-manager-detector/detect';
import { resolveCommand } from 'package-manager-detector/commands';

import { FiledistExtractEntry } from '../types';
import { spawnWithLog } from '../utils';

import { PACKAGE_CONFIG_FILENAME } from './config';

export type InitConfig = {
  /** File glob patterns to include in the package and use as selector for filesets. */
  files?: string[];
  /**
   * Optional config filename to embed in the generated bin shim so consumers use a
   * named config file (e.g. `.mypackage.yml`) instead of the default `.filedist.yml`.
   */
  baseConfigFile?: string;
};

/**
 * Scaffold or update a publishable npm data package.
 * If package.json already exists, updates it in place.
 * Creates bin/filedist.js if it does not already exist.
 * Writes .filedist-package.yml with the sets configuration.
 */
export async function actionInit(
  outputDir: string,
  verbose: boolean,
  config?: InitConfig,
): Promise<void> {
  const pkgJsonPath = path.join(outputDir, 'package.json');
  const binDir = path.join(outputDir, 'bin');
  const binPath = path.join(binDir, 'filedist.js');
  const packageConfigPath = path.join(outputDir, PACKAGE_CONFIG_FILENAME);

  const baseConfigFileArg = config?.baseConfigFile;
  const binShim = baseConfigFileArg
    ? `#!/usr/bin/env node\n'use strict';\nrequire('filedist').binpkg(__dirname, process.argv.slice(2), ${JSON.stringify(baseConfigFileArg)});\n`
    : `#!/usr/bin/env node\n'use strict';\nrequire('filedist').binpkg(__dirname, process.argv.slice(2));\n`;

  fs.mkdirSync(outputDir, { recursive: true });

  // Read existing package.json or create a new skeleton
  let pkgJson: Record<string, unknown>;
  if (fs.existsSync(pkgJsonPath)) {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as Record<string, unknown>;
  } else {
    const dirName = path.basename(outputDir);
    pkgJson = {
      name: dirName,
      version: '1.0.0',
      description: '',
      dependencies: {},
    };
  }

  const filePatterns = config?.files ?? [];

  // Set bin entry
  pkgJson.bin = 'bin/filedist.js';

  // Update npm files list to include data patterns, the bin shim, and the package config
  const npmFiles = new Set<string>([
    ...filePatterns,
    'package.json',
    'bin/filedist.js',
    PACKAGE_CONFIG_FILENAME,
  ]);
  pkgJson.files = Array.from(npmFiles);

  // Remove legacy filedist field if present (config now lives in .filedist-package.yml)
  delete pkgJson.filedist;

  // Write updated package.json (dependencies are managed by the `add` command below)
  // eslint-disable-next-line unicorn/no-null
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8');

  // Build filedist sets: self entry only (local files). Additional upstream packages
  // must be added manually to .filedist-package.yml.
  const selfEntry: FiledistExtractEntry = {
    output: { path: '.' },
    ...(filePatterns.length > 0 ? { selector: { files: filePatterns } } : {}),
  };
  const packageConfigData = { sets: [selfEntry] };
  fs.writeFileSync(packageConfigPath, yaml.dump(packageConfigData, { indent: 2 }), 'utf8');

  // Create bin/filedist.js only if it does not already exist
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(binPath, binShim, 'utf8');
    fs.chmodSync(binPath, 0o755);
  }

  // Add filedist + any external packages via the package manager so the lockfile
  // and package.json dependencies are updated with the correct resolved versions.
  const detected = await detect({ cwd: outputDir });
  const agent = detected?.agent ?? 'npm';
  const packagesToAdd = ['filedist'];
  const addResolved = resolveCommand(agent, 'add', packagesToAdd);
  if (addResolved) {
    spawnWithLog(addResolved.command, addResolved.args, outputDir, verbose, true);
  }

  if (verbose) {
    console.log(`Updated: ${pkgJsonPath}`);
    console.log(`Written: ${packageConfigPath}`);
    console.log(`Created: ${binPath}`);
  }
}
