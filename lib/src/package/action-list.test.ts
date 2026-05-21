import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { writeManagedFilesForDir } from './lockfile';
import { actionList } from './action-list';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-action-list-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionList', () => {
  it('returns empty array when marker does not exist', () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = actionList({ cwd: tmpDir, outputDir });
    expect(result).toHaveLength(0);
  });

  it('returns managed files from lock file', () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
      {
        path: 'docs/guide.md',
        packageName: 'mypkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const result = actionList({ cwd: tmpDir, outputDir });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.path)).toContain('README.md');
    expect(result.map((r) => r.path)).toContain('docs/guide.md');
  });

  it('returns only entries for the requested output directory', () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);

    const result = actionList({ cwd: tmpDir, outputDir });
    expect(result).toHaveLength(1);
  });

  it('uses explicit outputDir when provided', () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    writeManagedFilesForDir(tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'p',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);

    const result = actionList({ cwd: tmpDir, outputDir });
    expect(result.map((r) => r.path)).toContain('a.md');
  });

  it('reads from distinct output directories independently', () => {
    const out1 = path.join(tmpDir, 'out1');
    const out2 = path.join(tmpDir, 'out2');
    fs.mkdirSync(out1, { recursive: true });
    fs.mkdirSync(out2, { recursive: true });

    writeManagedFilesForDir(tmpDir, out1, [
      {
        path: 'a.md',
        packageName: 'pkg1',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    writeManagedFilesForDir(tmpDir, out2, [
      {
        path: 'b.md',
        packageName: 'pkg2',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);

    const result = actionList({ cwd: tmpDir, outputDir: out1 });
    expect(result.map((r) => r.path)).toContain('a.md');
    expect(result.map((r) => r.path)).not.toContain('b.md');

    const result2 = actionList({ cwd: tmpDir, outputDir: out2 });
    expect(result2.map((r) => r.path)).toContain('b.md');
    expect(result2.map((r) => r.path)).not.toContain('a.md');
  });
});
