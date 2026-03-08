/* eslint-disable unicorn/no-null */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ManagedFileMetadata } from '../types';

import { checkFileset } from './check';
import { installMockPackage } from './test-utils';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-check-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeMarker = (relPath: string, pkg = 'mypkg', ver = '1.0.0'): ManagedFileMetadata => ({
  path: relPath,
  packageName: pkg,
  packageVersion: ver,
});

describe('checkFileset – package not installed', () => {
  it('reports all marker entries as missing', async () => {
    const marker: ManagedFileMetadata[] = [
      makeMarker('docs/README.md'),
      makeMarker('lib/index.js'),
    ];
    const result = await checkFileset(null, tmpDir, {}, { path: '.' }, marker);
    expect(result.missing).toEqual(['docs/README.md', 'lib/index.js']);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });
});

describe('checkFileset – with installed package', () => {
  const PKG_NAME = 'check-test-pkg';
  // Use a custom selector that includes all files (README.md is excluded by default patterns)
  const anyFileSelector = { files: ['**'] };

  it('reports nothing when files match exactly', async () => {
    const pkgPath = await installMockPackage(PKG_NAME, '1.0.0', { 'README.md': '# Hello' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write "extracted" file with same content
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# Hello');

    // Build a marker entry for the file
    const marker: ManagedFileMetadata[] = [
      { path: 'README.md', packageName: PKG_NAME, packageVersion: '1.0.0' },
    ];

    const result = await checkFileset(
      pkgPath,
      outputDir,
      anyFileSelector,
      { path: outputDir },
      marker,
    );
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    // extra includes package.json because it's in the package but not in marker
  }, 60000);

  it('reports modified when destination content differs from source', async () => {
    const pkgPath = await installMockPackage(
      PKG_NAME,
      '1.0.0',
      { 'README.md': '# Original' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write "extracted" file with DIFFERENT content
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# Modified by user');

    const marker: ManagedFileMetadata[] = [
      { path: 'README.md', packageName: PKG_NAME, packageVersion: '1.0.0' },
    ];

    const result = await checkFileset(
      pkgPath,
      outputDir,
      anyFileSelector,
      { path: outputDir },
      marker,
    );
    expect(result.modified).toContain('README.md');
  }, 60000);

  it('reports missing when extracted file deleted from disk', async () => {
    const pkgPath = await installMockPackage(PKG_NAME, '1.0.0', { 'README.md': '# Hello' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    // Do NOT write the destination file

    const marker: ManagedFileMetadata[] = [makeMarker('README.md', PKG_NAME, '1.0.0')];

    const result = await checkFileset(
      pkgPath,
      outputDir,
      anyFileSelector,
      { path: outputDir },
      marker,
    );
    expect(result.missing).toContain('README.md');
  }, 60000);

  it('reports extra when package file is not in the marker', async () => {
    const pkgPath = await installMockPackage(
      PKG_NAME,
      '1.0.0',
      { 'README.md': '# Hello', 'docs/extra.md': 'extra' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# Hello');

    // Only README.md in marker — docs/extra.md is "extra" (and package.json too)
    const marker: ManagedFileMetadata[] = [
      { path: 'README.md', packageName: PKG_NAME, packageVersion: '1.0.0' },
    ];

    const result = await checkFileset(
      pkgPath,
      outputDir,
      anyFileSelector,
      { path: outputDir },
      marker,
    );
    expect(result.extra).toContain('docs/extra.md');
  }, 60000);
});
