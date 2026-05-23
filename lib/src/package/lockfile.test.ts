import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import {
  readLockfile,
  writeLockfile,
  buildLockfileData,
  computeLockfileChecksum,
  readManagedFilesForDir,
  writeManagedFilesForDir,
  readSetsFromLockfile,
  LockfileData,
} from './lockfile';

describe('lockfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-lockfile-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('readLockfile', () => {
    it('returns undefined when lock file does not exist', () => {
      expect(readLockfile(path.join(tmpDir, '.filedist.lock'))).toBeUndefined();
    });

    it('returns parsed data for a valid lock file', () => {
      const data: LockfileData = {
        version: 1,
        packages: { 'eslint@^8': '8.57.0' },
      };
      writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
      const result = readLockfile(path.join(tmpDir, '.filedist.lock'));
      expect(result).not.toBeUndefined();
      expect(result!.version).toBe(1);
      expect(result!.packages['eslint@^8']).toBe('8.57.0');
    });

    it('throws when lock file contains invalid YAML', () => {
      fs.writeFileSync(path.join(tmpDir, '.filedist.lock'), 'key: [unclosed');
      expect(() => readLockfile(path.join(tmpDir, '.filedist.lock'))).toThrow('invalid YAML');
    });

    it('throws when lock file has unexpected format', () => {
      fs.writeFileSync(path.join(tmpDir, '.filedist.lock'), yaml.dump({ foo: 'bar' }));
      expect(() => readLockfile(path.join(tmpDir, '.filedist.lock'))).toThrow('unexpected format');
    });

    it('throws when checksum is present but does not match', () => {
      const data: LockfileData = {
        version: 1,
        packages: { 'pkg@1': '1.0.0' },
        checksum: 'deadbeef',
      };
      fs.writeFileSync(path.join(tmpDir, '.filedist.lock'), yaml.dump(data));
      expect(() => readLockfile(path.join(tmpDir, '.filedist.lock'))).toThrow('corrupted');
    });

    it('passes when checksum is valid', () => {
      const data: LockfileData = {
        version: 1,
        packages: { 'pkg@1': '1.0.0' },
      };
      writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
      expect(() => readLockfile(path.join(tmpDir, '.filedist.lock'))).not.toThrow();
    });
  });

  describe('writeLockfile', () => {
    it('writes a readable YAML lock file', () => {
      const data: LockfileData = {
        version: 1,
        packages: { 'my-pkg@^1': '1.2.3' },
      };
      writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
      const lockPath = path.join(tmpDir, '.filedist.lock');
      expect(fs.existsSync(lockPath)).toBe(true);
      const raw = fs.readFileSync(lockPath, 'utf8');
      const parsed = yaml.load(raw) as LockfileData;
      expect(parsed.version).toBe(1);
      expect(parsed.packages['my-pkg@^1']).toBe('1.2.3');
    });

    it('writes a checksum field', () => {
      writeLockfile(path.join(tmpDir, '.filedist.lock'), {
        version: 1,
        packages: { 'p@1': '1.0.0' },
      });
      const raw = fs.readFileSync(path.join(tmpDir, '.filedist.lock'), 'utf8');
      const parsed = yaml.load(raw) as LockfileData;
      expect(parsed.checksum).toBeDefined();
      expect(typeof parsed.checksum).toBe('string');
    });

    it('ends with a newline', () => {
      writeLockfile(path.join(tmpDir, '.filedist.lock'), { version: 1, packages: {} });
      const raw = fs.readFileSync(path.join(tmpDir, '.filedist.lock'), 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    });
  });

  describe('buildLockfileData', () => {
    it('builds a lock file from a resolved packages map', () => {
      const resolved = new Map([
        ['eslint@^8', { source: 'npm' as const, resolvedVersion: '8.57.0' }],
        ['git:github.com/org/repo.git@main', { source: 'git' as const, resolvedVersion: 'abc123' }],
      ]);
      const data = buildLockfileData(resolved);
      expect(data.version).toBe(1);
      expect(Object.keys(data.packages)).toHaveLength(2);
      expect(data.packages['eslint@^8']).toBe('8.57.0');
      expect(data.packages['git:github.com/org/repo.git@main']).toBe('abc123');
    });

    it('returns empty packages for empty map', () => {
      const data = buildLockfileData(new Map());
      expect(Object.keys(data.packages)).toHaveLength(0);
    });
  });

  describe('computeLockfileChecksum', () => {
    it('produces a 12-char hex string', () => {
      const cs = computeLockfileChecksum({ packages: { 'p@1': '1.0.0' } });
      expect(cs).toMatch(/^[\da-f]{12}$/);
    });

    it('is deterministic regardless of key insertion order', () => {
      const cs1 = computeLockfileChecksum({ packages: { a: '1', b: '2' } });
      const cs2 = computeLockfileChecksum({ packages: { b: '2', a: '1' } });
      expect(cs1).toBe(cs2);
    });

    it('changes when packages change', () => {
      const cs1 = computeLockfileChecksum({ packages: { 'p@1': '1.0.0' } });
      const cs2 = computeLockfileChecksum({ packages: { 'p@1': '2.0.0' } });
      expect(cs1).not.toBe(cs2);
    });

    it('changes when files change', () => {
      const cs1 = computeLockfileChecksum({
        packages: {},
        files: { out: ['a.md|p|1|file|abc|0'] },
      });
      const cs2 = computeLockfileChecksum({
        packages: {},
        files: { out: ['b.md|p|1|file|abc|0'] },
      });
      expect(cs1).not.toBe(cs2);
    });
  });

  describe('roundtrip', () => {
    it('write then read produces equivalent data', () => {
      const data: LockfileData = {
        version: 1,
        packages: {
          'pkg-a@^2': '2.1.0',
          'git:host/repo.git@v3': 'dead1234beef',
        },
      };
      writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
      const result = readLockfile(path.join(tmpDir, '.filedist.lock'));
      expect(result!.version).toBe(data.version);
      expect(result!.packages).toEqual(data.packages);
    });

    it('preserves files on roundtrip', () => {
      const data: LockfileData = {
        version: 1,
        packages: { 'pkg@^1': '1.0.0' },
        files: {
          output: ['file.md|pkg|1.0.0|file|abc123|0'],
        },
      };
      writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
      const result = readLockfile(path.join(tmpDir, '.filedist.lock'));
      expect(result?.files).toEqual(data.files);
    });
  });
});

describe('readManagedFilesForDir / writeManagedFilesForDir', () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-managed-files-test-'));
    outputDir = path.join(tmpDir, 'output');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty array when lock file does not exist', () => {
    expect(readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir)).toEqual(
      [],
    );
  });

  it('returns empty array when managed_files key is absent', () => {
    writeLockfile(path.join(tmpDir, '.filedist.lock'), { version: 1, packages: {} });
    expect(readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir)).toEqual(
      [],
    );
  });

  it('writes and reads back managed file entries', () => {
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'docs/guide.md',
        packageName: 'my-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const result = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('docs/guide.md');
    expect(result[0].packageName).toBe('my-pkg');
    expect(result[0].packageVersion).toBe('1.0.0');
    expect(result[0].kind).toBe('file');
  });

  it('preserves packages when writing managed files', () => {
    writeLockfile(path.join(tmpDir, '.filedist.lock'), {
      version: 1,
      packages: { 'my-pkg': '1.0.0' },
    });
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'my-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const lock = readLockfile(path.join(tmpDir, '.filedist.lock'));
    expect(lock?.packages['my-pkg']).toBe('1.0.0');
  });

  it('round-trips checksum and mutable fields', () => {
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'file.ts',
        packageName: 'pkg',
        packageVersion: '2.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: true,
      },
    ]);
    const result = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(result[0].checksum).toBe('abc123');
    expect(result[0].mutable).toBe(true);
  });

  it('round-trips symlink kind', () => {
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'links/guide.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const result = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(result[0].kind).toBe('symlink');
  });

  it('removes entry when entries is empty', () => {
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, []);
    const lock = readLockfile(path.join(tmpDir, '.filedist.lock'));
    expect(lock?.files).toBeUndefined();
  });

  it('uses relative path as key in files', () => {
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const lock = readLockfile(path.join(tmpDir, '.filedist.lock'));
    expect(lock?.files?.['output']).toBeDefined();
  });
});

describe('readSetsFromLockfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-lockfile-sets-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns undefined when lockfile does not exist', () => {
    expect(readSetsFromLockfile(path.join(tmpDir, '.filedist.lock'))).toBeUndefined();
  });

  it('returns undefined when lockfile has no sets key', () => {
    const data: LockfileData = { version: 1, packages: {} };
    writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
    expect(readSetsFromLockfile(path.join(tmpDir, '.filedist.lock'))).toBeUndefined();
  });

  it('returns undefined when lockfile has empty sets array', () => {
    const data: LockfileData = { version: 1, packages: {}, sets: [] };
    writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
    expect(readSetsFromLockfile(path.join(tmpDir, '.filedist.lock'))).toBeUndefined();
  });

  it('returns sets when lockfile has non-empty sets', () => {
    const sets = [{ package: 'pkg@1.0.0', output: { path: './out', gitignore: false } }];
    const data: LockfileData = { version: 1, packages: {}, sets };
    writeLockfile(path.join(tmpDir, '.filedist.lock'), data);
    const result = readSetsFromLockfile(path.join(tmpDir, '.filedist.lock'));
    expect(result).not.toBeUndefined();
    expect(result![0].package).toBe('pkg@1.0.0');
  });
});
