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
} from './utils';

describe('parsePackageSpec', () => {
  it('parses a plain package name', () => {
    // eslint-disable-next-line no-undefined
    expect(parsePackageSpec('my-pkg')).toEqual({ name: 'my-pkg', version: undefined });
  });

  it('parses a package with a version', () => {
    expect(parsePackageSpec('my-pkg@^1.2.3')).toEqual({ name: 'my-pkg', version: '^1.2.3' });
  });

  it('parses a scoped package name without version', () => {
    // eslint-disable-next-line no-undefined
    expect(parsePackageSpec('@scope/my-pkg')).toEqual({
      name: '@scope/my-pkg',
      // eslint-disable-next-line no-undefined
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
    // eslint-disable-next-line no-undefined
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
  // eslint-disable-next-line camelcase
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
