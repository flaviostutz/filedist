/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Scaffold a new publishable npm data package.
 * Creates package.json and bin/npmdata.js in the target directory.
 */
export async function actionInit(outputDir: string, verbose: boolean): Promise<void> {
  const pkgJsonPath = path.join(outputDir, 'package.json');
  const binDir = path.join(outputDir, 'bin');
  const binPath = path.join(binDir, 'npmdata.js');

  if (fs.existsSync(pkgJsonPath)) {
    throw new Error(`Target directory already has a package.json: ${pkgJsonPath}`);
  }
  if (fs.existsSync(binPath)) {
    throw new Error(`Target directory already has a bin/npmdata.js: ${binPath}`);
  }

  const dirName = path.basename(outputDir);

  const packageJson = {
    name: dirName,
    version: '1.0.0',
    description: '',
    bin: {
      npmdata: 'bin/npmdata.js',
    },
    files: ['bin/', 'data/'],
    dependencies: {
      npmdata: '*',
    },
  };

  const binShim = `#!/usr/bin/env node
'use strict';
require('npmdata').run(__dirname, process.argv.slice(2));
`;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  // eslint-disable-next-line unicorn/no-null
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  fs.writeFileSync(binPath, binShim, 'utf8');
  fs.chmodSync(binPath, 0o755);

  if (verbose) {
    console.log(`Created: ${pkgJsonPath}`);
    console.log(`Created: ${binPath}`);
  }
}
