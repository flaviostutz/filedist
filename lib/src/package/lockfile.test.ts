import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readLockfile,
  writeLockfile,
  buildLockfileData,
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
      expect(readLockfile(tmpDir)).toBeUndefined();
    });

    it('returns parsed data for a valid lock file', () => {
      const data: LockfileData = {
        lockfileVersion: 1,
        packages: {
          'eslint@^8': { ref: '8.57.0' },
        },
      };
      fs.writeFileSync(path.join(tmpDir, '.filedist.lock'), JSON.stringify(data));
      const result = readLockfile(tmpDir);
      expect(result).not.toBeUndefined();
      expect(result!.lockfileVersion).toBe(1);
      expect(result!.packages['eslint@^8'].ref).toBe('8.57.0');
    });

    it('throws when lock file contains invalid JSON', () => {
      fs.writeFileSync(path.join(tmpDir, '.filedist.lock'), 'not valid json{{');
      expect(() => readLockfile(tmpDir)).toThrow('invalid JSON');
    });

    it('throws when lock file has unexpected format', () => {
      fs.writeFileSync(path.join(tmpDir, '.filedist.lock'), JSON.stringify({ foo: 'bar' }));
      expect(() => readLockfile(tmpDir)).toThrow('unexpected format');
    });
  });

  describe('writeLockfile', () => {
    it('writes a readable lock file', () => {
      const data: LockfileData = {
        lockfileVersion: 1,
        packages: {
          'my-pkg@^1': { ref: '1.2.3' },
        },
      };
      writeLockfile(tmpDir, data);
      const lockPath = path.join(tmpDir, '.filedist.lock');
      expect(fs.existsSync(lockPath)).toBe(true);
      const raw = fs.readFileSync(lockPath);
      const parsed = JSON.parse(raw.toString()) as LockfileData;
      expect(parsed.lockfileVersion).toBe(1);
      expect(parsed.packages['my-pkg@^1'].ref).toBe('1.2.3');
    });

    it('ends with a newline', () => {
      writeLockfile(tmpDir, { lockfileVersion: 1, packages: {} });
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
      expect(data.lockfileVersion).toBe(1);
      expect(Object.keys(data.packages)).toHaveLength(2);
      expect(data.packages['eslint@^8'].ref).toBe('8.57.0');
      expect(data.packages['git:github.com/org/repo.git@main'].ref).toBe('abc123');
    });

    it('returns empty packages for empty map', () => {
      const data = buildLockfileData(new Map());
      expect(Object.keys(data.packages)).toHaveLength(0);
    });
  });

  describe('roundtrip', () => {
    it('write then read produces identical data', () => {
      const data: LockfileData = {
        lockfileVersion: 1,
        packages: {
          'pkg-a@^2': { ref: '2.1.0' },
          'git:host/repo.git@v3': { ref: 'dead1234beef' },
        },
      };
      writeLockfile(tmpDir, data);
      const result = readLockfile(tmpDir);
      expect(result).toEqual(data);
    });

    it('preserves managed_files on roundtrip', () => {
      const data: LockfileData = {
        lockfileVersion: 1,
        packages: { 'pkg@^1': { ref: '1.0.0' } },
        // eslint-disable-next-line camelcase
        managed_files: {
          output: ['file.md|pkg|1.0.0|file|abc123|0'],
        },
      };
      writeLockfile(tmpDir, data);
      const result = readLockfile(tmpDir);

      expect(result?.managed_files).toEqual(data.managed_files);
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
    expect(readManagedFilesForDir(tmpDir, outputDir)).toEqual([]);
  });

  it('returns empty array when managed_files key is absent', () => {
    writeLockfile(tmpDir, { lockfileVersion: 1, packages: {} });
    expect(readManagedFilesForDir(tmpDir, outputDir)).toEqual([]);
  });

  it('writes and reads back managed file entries', () => {
    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'docs/guide.md',
        packageName: 'my-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const result = readManagedFilesForDir(tmpDir, outputDir);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('docs/guide.md');
    expect(result[0].packageName).toBe('my-pkg');
    expect(result[0].packageVersion).toBe('1.0.0');
    expect(result[0].kind).toBe('file');
  });

  it('preserves packages when writing managed files', () => {
    writeLockfile(tmpDir, { lockfileVersion: 1, packages: { 'my-pkg': { ref: '1.0.0' } } });
    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'my-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const lock = readLockfile(tmpDir);
    expect(lock?.packages['my-pkg']?.ref).toBe('1.0.0');
  });

  it('round-trips checksum and mutable fields', () => {
    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'file.ts',
        packageName: 'pkg',
        packageVersion: '2.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: true,
      },
    ]);
    const result = readManagedFilesForDir(tmpDir, outputDir);
    expect(result[0].checksum).toBe('abc123');
    expect(result[0].mutable).toBe(true);
  });

  it('round-trips symlink kind', () => {
    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'links/guide.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const result = readManagedFilesForDir(tmpDir, outputDir);
    expect(result[0].kind).toBe('symlink');
  });

  it('removes entry when entries is empty', () => {
    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    writeManagedFilesForDir(tmpDir, outputDir, []);
    const lock = readLockfile(tmpDir);
    expect(lock?.managed_files).toBeUndefined();
  });

  it('uses relative path as key in managed_files', () => {
    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const lock = readLockfile(tmpDir);
    expect(lock?.managed_files?.['output']).toBeDefined();
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
    expect(readSetsFromLockfile(tmpDir)).toBeUndefined();
  });

  it('returns undefined when lockfile has no sets key', () => {
    const data: LockfileData = { lockfileVersion: 1, packages: {} };
    writeLockfile(tmpDir, data);
    expect(readSetsFromLockfile(tmpDir)).toBeUndefined();
  });

  it('returns undefined when lockfile has empty sets array', () => {
    const data: LockfileData = { lockfileVersion: 1, packages: {}, sets: [] };
    writeLockfile(tmpDir, data);
    expect(readSetsFromLockfile(tmpDir)).toBeUndefined();
  });

  it('returns sets when lockfile has non-empty sets', () => {
    const sets = [{ package: 'pkg@1.0.0', output: { path: './out', gitignore: false } }];
    const data: LockfileData = { lockfileVersion: 1, packages: {}, sets };
    writeLockfile(tmpDir, data);
    const result = readSetsFromLockfile(tmpDir);
    expect(result).not.toBeUndefined();
    expect(result![0].package).toBe('pkg@1.0.0');
  });
});
