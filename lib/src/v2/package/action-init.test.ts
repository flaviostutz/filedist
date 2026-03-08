import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { actionInit } from './action-init';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-action-init-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionInit', () => {
  it('creates package.json in a new directory', async () => {
    const outputDir = path.join(tmpDir, 'my-data-pkg');
    await actionInit(outputDir, false);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')));
    expect(pkgJson.name).toBe('my-data-pkg');
    expect(pkgJson.version).toBe('1.0.0');
    expect(pkgJson.bin.npmdata).toBe('bin/npmdata.js');
  });

  it('creates bin/npmdata.js shim', async () => {
    const outputDir = path.join(tmpDir, 'my-pkg');
    await actionInit(outputDir, false);

    const binPath = path.join(outputDir, 'bin', 'npmdata.js');
    expect(fs.existsSync(binPath)).toBe(true);
    const content = fs.readFileSync(binPath, 'utf8');
    expect(content).toContain("require('npmdata').run");
  });

  it('throws if package.json already exists', async () => {
    const outputDir = path.join(tmpDir, 'existing-pkg');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'package.json'), '{}');

    await expect(actionInit(outputDir, false)).rejects.toThrow('already has a package.json');
  });

  it('throws if bin/npmdata.js already exists', async () => {
    const outputDir = path.join(tmpDir, 'existing-bin');
    fs.mkdirSync(path.join(outputDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'bin', 'npmdata.js'), '#!/usr/bin/env node');

    await expect(actionInit(outputDir, false)).rejects.toThrow('already has a bin/npmdata.js');
  });

  it('logs created files when verbose=true', async () => {
    const outputDir = path.join(tmpDir, 'verbose-pkg');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await actionInit(outputDir, true);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('package.json'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('npmdata.js'));
    consoleSpy.mockRestore();
  });
});
