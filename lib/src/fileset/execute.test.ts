import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ExtractionMap, ManagedFileMetadata } from '../types';

import { execute, rollback } from './execute';
import { readMarker } from './markers';
import { MARKER_FILE, GITIGNORE_FILE } from './constants';

describe('execute', () => {
  let tmpDir: string;
  let pkgDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-execute-test-'));
    pkgDir = path.join(tmpDir, 'pkg');
    outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    // Make all files writable before cleanup
    try {
      fs.chmodSync(outputDir, 0o755);
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  const writeFile = (dir: string, relPath: string, content: string): string => {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return fullPath;
  };

  const makeMap = (overrides?: Partial<ExtractionMap>): ExtractionMap => ({
    toAdd: [],
    toModify: [],
    toDelete: [],
    toSkip: [],
    conflicts: [],
    ...overrides,
  });

  it('writes toAdd files to outputDir', async () => {
    const srcPath = writeFile(pkgDir, 'docs/guide.md', '# Guide');
    const destPath = path.join(outputDir, 'docs/guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'docs/guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(map, outputDir, { path: '.' }, { name: 'my-pkg' }, '1.0.0', [], tmpDir);

    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf8')).toBe('# Guide');
  });

  it('makes written files read-only (managed mode)', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    const stat = fs.statSync(destPath);

    expect(stat.mode & 0o200).toBe(0); // no write bit
  });

  it('updates .npmdata marker file', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    const marker = await readMarker(path.join(outputDir, MARKER_FILE));
    expect(marker).toHaveLength(1);
    expect(marker[0].path).toBe('guide.md');
    expect(marker[0].packageName).toBe('my-pkg');
    expect(marker[0].packageVersion).toBe('1.0.0');
  });

  it('updates .gitignore when gitignore is not disabled', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: true },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    const gitignoreContent = fs.readFileSync(path.join(outputDir, GITIGNORE_FILE), 'utf8');
    expect(gitignoreContent).toContain('guide.md');
  });

  it('does not write files in dryRun mode', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', dryRun: true },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('makes dest file writable before overwriting when toAdd dest already exists', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# NewContent');
    const destPath = path.join(outputDir, 'guide.md');
    // Pre-create the destination as read-only
    fs.writeFileSync(destPath, '# Old');
    fs.chmodSync(destPath, 0o444);

    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    expect(fs.readFileSync(destPath, 'utf8')).toBe('# NewContent');
  });

  it('does not write marker or gitignore in dryRun mode', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', dryRun: true, gitignore: true },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    expect(fs.existsSync(path.join(outputDir, MARKER_FILE))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, GITIGNORE_FILE))).toBe(false);
  });

  it('preserves existing marker entries from other packages', async () => {
    const srcPath = writeFile(pkgDir, 'new.md', 'new');
    const destPath = path.join(outputDir, 'new.md');
    const existingMarker: ManagedFileMetadata[] = [
      { path: 'other.md', packageName: 'other-pkg', packageVersion: '1.0.0' },
    ];
    const map = makeMap({
      toAdd: [{ relPath: 'new.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      existingMarker,
      tmpDir,
    );

    const marker = await readMarker(path.join(outputDir, MARKER_FILE));
    expect(marker).toHaveLength(2);
    const names = marker.map((m) => m.path);
    expect(names).toContain('other.md');
    expect(names).toContain('new.md');
  });
});

describe('rollback', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-rollback-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('deletes newly created files', async () => {
    const file = path.join(tmpDir, 'new-file.md');
    fs.writeFileSync(file, 'content');
    await rollback([file]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('ignores files that do not exist', async () => {
    await expect(rollback([path.join(tmpDir, 'nonexistent.md')])).resolves.toBeUndefined();
  });
});
