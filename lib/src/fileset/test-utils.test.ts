import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { installMockPackage } from './test-utils';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-test-utils-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('installMockPackage', () => {
  it('installs a package into node_modules and returns the installed path', async () => {
    const pkgPath = await installMockPackage(
      'util-test-pkg',
      '1.0.0',
      { 'README.md': '# Hello' },
      tmpDir,
    );
    expect(fs.existsSync(pkgPath)).toBe(true);
    expect(fs.existsSync(path.join(pkgPath, 'README.md'))).toBe(true);
  }, 60_000);

  it('cleans up existing source directory before re-creating it', async () => {
    // Pre-create the source directory to exercise the rmSync branch
    const packageDir = path.join(tmpDir, 'util-reuse-pkg-source');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'stale.txt'), 'stale');

    const pkgPath = await installMockPackage(
      'util-reuse-pkg',
      '1.0.0',
      { 'README.md': '# Reuse' },
      tmpDir,
    );
    expect(fs.existsSync(pkgPath)).toBe(true);
    // Stale file should be gone — source dir was wiped and rebuilt
    expect(fs.existsSync(path.join(packageDir, 'stale.txt'))).toBe(false);
  }, 60_000);
});
