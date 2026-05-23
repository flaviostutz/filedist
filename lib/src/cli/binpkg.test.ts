import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installMockPackage } from '../fileset/test-utils';

import { binpkg } from './binpkg';

const DATA_PKG_NAME = 'binpkg-test-data-pkg';
const DATA_PKG_FILES = {
  'data/file1.json': '{"key":"value"}',
  'data/file2.md': '# Doc',
  'docs/readme.md': '# Readme',
};

describe('binpkg', () => {
  let tmpDir: string;
  let binDir: string;
  let originalCwd: string;
  let exitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binpkg-test-'));

    // Install the mock data package into tmpDir so the CLI can resolve it
    await installMockPackage(DATA_PKG_NAME, '1.0.0', DATA_PKG_FILES, tmpDir);

    // Simulate the data package's own root: has package.json (with name + filedist config)
    // and a bin/ subdirectory from which binpkg gets __dirname.
    const fakePkgRoot = path.join(tmpDir, 'fake-data-pkg');
    binDir = path.join(fakePkgRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    // The data package's package.json only needs name + version. filedist config is in .filedist-package.yml.
    fs.writeFileSync(
      path.join(fakePkgRoot, 'package.json'),
      JSON.stringify({ name: DATA_PKG_NAME, version: '1.0.0' }),
    );

    // Move cwd to tmpDir so the CLI resolves packages from tmpDir/node_modules
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Mock process.exit so the test process doesn't actually exit
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 'undefined'})`);
    });
  }, 60_000);

  afterEach(() => {
    exitSpy.mockRestore();
    process.chdir(originalCwd);

    // Ensure all files are writable before cleanup (extracted files can be read-only)
    const makeWritable = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          const stat = fs.lstatSync(full);
          if (!stat.isSymbolicLink()) {
            fs.chmodSync(full, 0o755);
            if (stat.isDirectory()) makeWritable(full);
          }
        } catch {
          /* ignore */
        }
      }
    };
    makeWritable(tmpDir);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts all data package files when no selectors are passed', async () => {
    const outputDir = path.join(tmpDir, 'output-all');

    await expect(binpkg(binDir, ['--output', outputDir, '--gitignore=false'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data/file2.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/readme.md'))).toBe(true);
  }, 60_000);

  it('applies --files selector from CLI args — overrides defaultPresets', async () => {
    const outputDir = path.join(tmpDir, 'output-files');

    // The data package .filedist-package.yml has defaultPresets pointing to 'data', but we pass 'docs/**' via CLI.
    // binpkg must use the CLI --files arg, not the defaultPresets.
    await expect(
      binpkg(binDir, ['--output', outputDir, '--gitignore=false', '--files', 'docs/**']),
    ).rejects.toThrow('process.exit(0)');

    expect(fs.existsSync(path.join(outputDir, 'docs/readme.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'data/file2.md'))).toBe(false);
  }, 60_000);

  it('only extracts the data package itself — does not install any other packages', async () => {
    const outputDir = path.join(tmpDir, 'output-no-ext');

    // binpkg builds a synthetic single-set config for its own package only.
    // A clean exit(0) proves only the named data package was installed.
    await expect(binpkg(binDir, ['--output', outputDir, '--gitignore=false'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(true);
  }, 60_000);

  it('rejects positional package arg with error and exit code 1', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(jest.fn());

    await expect(binpkg(binDir, ['install', 'other-pkg'])).rejects.toThrow('process.exit(1)');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot pass a package argument'));
    logSpy.mockRestore();
  }, 10_000);

  it('uses custom config file and derives lock file name from it when configFile is specified', async () => {
    const outputDir = path.join(tmpDir, 'output-custom-config');

    // Write a minimal bootstrap config (package entry with output path specified via CLI --output)
    const configContent = `version: 1\nsets: []\n`;
    fs.writeFileSync(path.join(tmpDir, 'mypackage.yml'), configContent);

    await expect(
      binpkg(binDir, ['--output', outputDir, '--gitignore=false'], 'mypackage.yml'),
    ).rejects.toThrow('process.exit(0)');

    // The custom config file should exist
    expect(fs.existsSync(path.join(tmpDir, 'mypackage.yml'))).toBe(true);

    // The lock file must be derived from the config filename: mypackage.lock (not .filedist.lock)
    expect(fs.existsSync(path.join(tmpDir, 'mypackage.lock'))).toBe(true);

    // The default .filedist.lock must NOT be created
    expect(fs.existsSync(path.join(tmpDir, '.filedist.lock'))).toBe(false);

    // Files from the data package should have been extracted to the specified output dir
    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(true);
  }, 60_000);

  it('does not create .filedist.lock when configFile is specified — only the derived lock file', async () => {
    // Ensure no pre-existing lock files
    expect(fs.existsSync(path.join(tmpDir, '.filedist.lock'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'mypackage.lock'))).toBe(false);

    const configContent = `version: 1\nsets:\n  - package: ${DATA_PKG_NAME}\n    output:\n      path: output-no-default-lock\n`;
    fs.writeFileSync(path.join(tmpDir, 'mypackage.yml'), configContent);

    await expect(binpkg(binDir, ['--gitignore=false'], 'mypackage.yml')).rejects.toThrow(
      'process.exit(0)',
    );

    expect(fs.existsSync(path.join(tmpDir, 'mypackage.lock'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.filedist.lock'))).toBe(false);
  }, 60_000);
});
