/* eslint-disable unicorn/no-null */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { ManagedFileMetadata } from '../types';

import { checkFileset } from './check';
import { installMockPackage } from './test-utils';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-check-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeMarker = (relPath: string, pkg = 'mypkg', ver = '1.0.0'): ManagedFileMetadata => ({
  path: relPath,
  packageName: pkg,
  packageVersion: ver,
  kind: 'file',
  checksum: 'abc123',
  mutable: false,
});

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(18, 30);
}

describe('checkFileset – package not installed', () => {
  it('reports all marker entries as missing when files do not exist on disk', async () => {
    const marker: ManagedFileMetadata[] = [makeMarker('docs/guide.md'), makeMarker('lib/index.js')];
    const result = await checkFileset(null, tmpDir, marker);
    expect(result.missing).toEqual(['docs/guide.md', 'lib/index.js']);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('reports modified via checksum when files exist but content differs', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), '# Tampered');

    const originalContent = '# Original';
    const marker: ManagedFileMetadata[] = [
      {
        path: 'guide.md',
        packageName: 'mypkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256(originalContent),
        mutable: false,
      },
    ];

    const result = await checkFileset(null, outputDir, marker);
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toContain('guide.md');
    expect(result.extra).toHaveLength(0);
  });

  it('reports ok via checksum when file content matches stored hash', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const content = '# Hello';
    fs.writeFileSync(path.join(outputDir, 'guide.md'), content);

    const marker: ManagedFileMetadata[] = [
      {
        path: 'guide.md',
        packageName: 'mypkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256(content),
        mutable: false,
      },
    ];

    const result = await checkFileset(null, outputDir, marker);
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it('skips content check for mutable files even when content differs', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'config.json'), '{"changed": true}');

    const marker: ManagedFileMetadata[] = [
      {
        path: 'config.json',
        packageName: 'mypkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('{"original": true}'),
        mutable: true,
      },
    ];

    const result = await checkFileset(null, outputDir, marker);
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });
});

describe('checkFileset – with installed package', () => {
  const PKG_NAME = 'check-test-pkg';

  it('reports modified via stored checksum (no source needed)', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const originalContent = '# Original';
    fs.writeFileSync(path.join(outputDir, 'guide.md'), '# Modified by user');

    const marker: ManagedFileMetadata[] = [
      {
        path: 'guide.md',
        packageName: PKG_NAME,
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256(originalContent),
        mutable: false,
      },
    ];

    // pkgPath is null: source unavailable, but checksum available
    const result = await checkFileset(null, outputDir, marker);
    expect(result.modified).toContain('guide.md');
  }, 60000);

  it('reports missing when extracted file deleted from disk', async () => {
    const pkgPath = await installMockPackage(PKG_NAME, '1.0.0', { 'guide.md': '# Hello' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    // Do NOT write the destination file

    const marker: ManagedFileMetadata[] = [makeMarker('guide.md', PKG_NAME, '1.0.0')];

    const result = await checkFileset(pkgPath, outputDir, marker);
    expect(result.missing).toContain('guide.md');
  }, 60000);

  it('reports extra when package file is not in the marker', async () => {
    const pkgPath = await installMockPackage(
      PKG_NAME,
      '1.0.0',
      { 'guide.md': '# Hello', 'docs/extra.md': 'extra' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), '# Hello');

    // Only guide.md in marker — docs/extra.md is "extra" (and package.json too)
    const marker: ManagedFileMetadata[] = [
      {
        path: 'guide.md',
        packageName: PKG_NAME,
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# Hello'),
        mutable: false,
      },
    ];

    const result = await checkFileset(pkgPath, outputDir, marker);
    expect(result.extra).toContain('docs/extra.md');
  }, 60000);
});
