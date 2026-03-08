import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installedPackagePath, enumeratePackageFiles } from './package-files';
import { installMockPackage } from './test-utils';

describe('installedPackagePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-pkgfiles-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns null when package is not installed', () => {
    expect(installedPackagePath('nonexistent-pkg', tmpDir)).toBeNull();
  });

  it('returns the package path when installed', async () => {
    await installMockPackage('my-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    const result = installedPackagePath('my-pkg', tmpDir);
    expect(result).toBeTruthy();
    expect(result).toContain('my-pkg');
    expect(fs.existsSync(result!)).toBe(true);
  }, 60000);
});

describe('enumeratePackageFiles', () => {
  let tmpDir: string;
  let pkgPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-enumerate-test-'));
    pkgPath = await installMockPackage(
      'test-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        'docs/api.md': 'API docs with keyword: hello',
        'README.md': '# Test',
        'package.json': '{"name":"test-pkg"}',
        'bin/run.js': '#!/usr/bin/env node',
        'src/index.ts': 'export const x = 1;',
        'data/binary.bin': Buffer.from([0x00, 0x01, 0x02]).toString(),
      },
      tmpDir,
    );
  }, 60000);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('applies default file patterns (excludes package.json, bin/, README.md)', async () => {
    const files = await enumeratePackageFiles(pkgPath, {});
    expect(files).toContain('docs/guide.md');
    expect(files).toContain('src/index.ts');
    expect(files).not.toContain('package.json');
    expect(files).not.toContain('bin/run.js');
    expect(files).not.toContain('README.md');
  });

  it('applies custom glob filter', async () => {
    const files = await enumeratePackageFiles(pkgPath, { files: ['docs/**'] });
    expect(files).toContain('docs/guide.md');
    expect(files).toContain('docs/api.md');
    expect(files).not.toContain('src/index.ts');
  });

  it('applies contentRegexes filter', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['**'],
      contentRegexes: ['hello'],
    });
    expect(files).toContain('docs/api.md');
    expect(files).not.toContain('docs/guide.md');
    expect(files).not.toContain('src/index.ts');
  });

  it('does not exclude binary files when contentRegexes are set', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['data/**'],
      contentRegexes: ['somepattern'],
    });
    // Binary files pass through (cannot be scanned but may be legitimately needed)
    expect(files).toContain('data/binary.bin');
  });
});
