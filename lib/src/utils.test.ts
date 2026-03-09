/* eslint-disable no-undefined */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parsePackageSpec,
  hashFile,
  hashBuffer,
  hashFileSync,
  isBinaryFile,
  detectPackageManager,
  filterEntriesByPresets,
  ensureDir,
  getInstalledPackagePath,
  installPackage,
} from './utils';

describe('parsePackageSpec', () => {
  it('parses a plain package name', () => {
    expect(parsePackageSpec('my-pkg')).toEqual({ name: 'my-pkg', version: undefined });
  });

  it('parses a package with a version', () => {
    expect(parsePackageSpec('my-pkg@^1.2.3')).toEqual({ name: 'my-pkg', version: '^1.2.3' });
  });

  it('parses a scoped package name without version', () => {
    expect(parsePackageSpec('@scope/my-pkg')).toEqual({
      name: '@scope/my-pkg',

      version: undefined,
    });
  });

  it('parses a scoped package name with version', () => {
    expect(parsePackageSpec('@scope/my-pkg@2.x')).toEqual({
      name: '@scope/my-pkg',
      version: '2.x',
    });
  });

  it('handles empty version after @', () => {
    expect(parsePackageSpec('my-pkg@')).toEqual({ name: 'my-pkg', version: undefined });
  });
});

describe('hashFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns a hex SHA-256 hash of the file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const hash = await hashFile(filePath);
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });

  it('returns different hashes for files with different content', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fileA, 'content A');
    fs.writeFileSync(fileB, 'content B');
    const hashA = await hashFile(fileA);
    const hashB = await hashFile(fileB);
    expect(hashA).not.toBe(hashB);
  });

  it('returns the same hash for files with identical content', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fileA, 'same content');
    fs.writeFileSync(fileB, 'same content');
    const hashA = await hashFile(fileA);
    const hashB = await hashFile(fileB);
    expect(hashA).toBe(hashB);
  });
});

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-pm-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns pnpm when pnpm-lock.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('returns npm when package-lock.json exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  it('returns npm when no lock file exists', () => {
    const envKey = 'npm_config_user_agent';
    // eslint-disable-next-line no-process-env
    const savedUserAgent = process.env[envKey];
    // eslint-disable-next-line no-process-env
    delete process.env[envKey];
    try {
      expect(detectPackageManager(tmpDir)).toBe('npm');
    } finally {
      // eslint-disable-next-line no-process-env
      if (savedUserAgent !== undefined) process.env[envKey] = savedUserAgent;
    }
  });

  it('returns pnpm when both lock files exist (pnpm takes priority)', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects pnpm from npm_config_user_agent env var', () => {
    const envKey = 'npm_config_user_agent';
    // eslint-disable-next-line no-process-env
    const saved = process.env[envKey];
    // eslint-disable-next-line no-process-env
    process.env[envKey] = 'pnpm/8.0.0 npm/? node/v20.0.0 linux x64';
    try {
      expect(detectPackageManager(tmpDir)).toBe('pnpm');
    } finally {
      // eslint-disable-next-line no-process-env
      if (saved !== undefined) process.env[envKey] = saved;
      // eslint-disable-next-line no-process-env
      else delete process.env[envKey];
    }
  });
});

describe('hashFileSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-hashsync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns a hex SHA-256 hash synchronously', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const hash = hashFileSync(filePath);
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });

  it('matches the async hashFile result', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    const syncHash = hashFileSync(filePath);
    const asyncHash = await hashFile(filePath);
    expect(syncHash).toBe(asyncHash);
  });
});

describe('hashBuffer', () => {
  it('returns the SHA-256 hash of a string', () => {
    const hash = hashBuffer('hello world');
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });

  it('returns the same hash for identical strings', () => {
    expect(hashBuffer('abc')).toBe(hashBuffer('abc'));
  });
});

describe('isBinaryFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-binary-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for a text file', () => {
    const filePath = path.join(tmpDir, 'text.md');
    fs.writeFileSync(filePath, '# Hello World\nThis is text.');
    expect(isBinaryFile(filePath)).toBe(false);
  });

  it('returns true for a file containing null bytes', () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    // Write a buffer with a null byte (0x00) which marks binary files
    const buf = Buffer.alloc(4);
    buf.writeUInt8(72, 0); // H
    buf.writeUInt8(0, 1); // null byte — indicates binary
    buf.writeUInt8(105, 2); // i
    buf.writeUInt8(33, 3); // !
    fs.writeFileSync(filePath, buf);
    expect(isBinaryFile(filePath)).toBe(true);
  });

  it('returns false for a nonexistent file (catch branch)', () => {
    expect(isBinaryFile('/nonexistent/file')).toBe(false);
  });
});

describe('filterEntriesByPresets', () => {
  const baseEntry = { package: 'pkg@1.0.0', output: { path: 'out' } };

  it('returns all entries when presets list is empty', () => {
    const entries = [baseEntry, { ...baseEntry, package: 'pkg2@1.0.0' }];
    expect(filterEntriesByPresets(entries, [])).toEqual(entries);
  });

  it('returns only entries whose presets include the requested tag', () => {
    const entries = [
      { ...baseEntry, selector: { presets: ['docs'] } },
      { ...baseEntry, package: 'pkg2@1.0.0', selector: { presets: ['data'] } },
    ];
    expect(filterEntriesByPresets(entries, ['docs'])).toHaveLength(1);
    expect(filterEntriesByPresets(entries, ['docs'])[0].selector?.presets).toContain('docs');
  });

  it('excludes entries with no presets when a preset filter is applied', () => {
    const entries = [{ ...baseEntry }, { ...baseEntry, selector: { presets: ['docs'] } }];
    expect(filterEntriesByPresets(entries, ['docs'])).toHaveLength(1);
  });

  it('matches any of multiple requested preset tags', () => {
    const entries = [
      { ...baseEntry, selector: { presets: ['docs'] } },
      { ...baseEntry, package: 'pkg2@1.0.0', selector: { presets: ['data'] } },
    ];
    expect(filterEntriesByPresets(entries, ['docs', 'data'])).toHaveLength(2);
  });
});

describe('ensureDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ensuredir-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a directory that does not exist', () => {
    const myDir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(myDir);
    expect(fs.existsSync(myDir)).toBe(true);
  });

  it('does nothing when the directory already exists', () => {
    ensureDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);
  });
});

describe('getInstalledPackagePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-installed-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when the package is not installed', () => {
    expect(getInstalledPackagePath('nonexistent-pkg', tmpDir)).toBeNull();
  });

  it('returns the package directory when package.json exists under node_modules', () => {
    const pkgDir = path.join(tmpDir, 'node_modules', 'my-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"my-pkg"}');
    expect(getInstalledPackagePath('my-pkg', tmpDir)).toBe(pkgDir);
  });
});

describe('installPackage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-installpkg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns cached path when package already installed and upgrade is false', () => {
    const pkgDir = path.join(tmpDir, 'node_modules', 'cached-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"cached-pkg"}');
    const result = installPackage('cached-pkg', '1.0.0', false, tmpDir);
    expect(result).toBe(pkgDir);
  });

  it('throws an Error with detail when execSync fails', () => {
    // Attempt to install a definitely-nonexistent package so execSync fails
    expect(() => installPackage('__nonexistent_pkg_xyz_abc__', '0.0.1', true, tmpDir)).toThrow(
      /Failed to install/,
    );
  });
});
