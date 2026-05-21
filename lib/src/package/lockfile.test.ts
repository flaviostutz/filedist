import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readLockfile, writeLockfile, buildLockfileData, LockfileData } from './lockfile';

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
  });
});
