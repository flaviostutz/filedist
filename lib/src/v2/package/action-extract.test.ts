/* eslint-disable unicorn/no-null */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installMockPackage } from '../fileset/test-utils';
import { readMarker } from '../fileset/markers';
import { MARKER_FILE } from '../fileset/constants';

import { actionExtract } from './action-extract';

describe('actionExtract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-action-extract-test-'));
  });

  afterEach(() => {
    // Make all files writable before cleanup
    const makeWritable = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.lstatSync(fullPath);
          if (!stat.isSymbolicLink()) {
            fs.chmodSync(fullPath, 0o755);
            if (stat.isDirectory()) makeWritable(fullPath);
          }
        } catch {
          /* ignore */
        }
      }
    };
    makeWritable(tmpDir);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts files from a single package', async () => {
    await installMockPackage(
      'my-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        'docs/api.md': 'API Docs',
      },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionExtract({
      entries: [{ package: 'my-pkg', output: { path: outputDir, gitignore: false } }],
      config: null,
      cwd: tmpDir,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/api.md'))).toBe(true);
  }, 60000);

  it('writes .npmdata marker after extraction', async () => {
    await installMockPackage('marker-pkg', '1.0.0', { 'src/index.ts': 'export {}' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'marker-pkg', output: { path: outputDir, gitignore: false } }],
      config: null,
      cwd: tmpDir,
    });

    const marker = await readMarker(path.join(outputDir, MARKER_FILE));
    expect(marker.length).toBeGreaterThan(0);
    expect(marker[0].packageName).toBe('marker-pkg');
  }, 60000);

  it('dry-run reports without writing', async () => {
    await installMockPackage('dry-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [
        { package: 'dry-pkg', output: { path: outputDir, dryRun: true, gitignore: false } },
      ],
      config: null,
      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, MARKER_FILE))).toBe(false);
  }, 60000);

  it('force overwrites unmanaged files', async () => {
    await installMockPackage('force-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await actionExtract({
      entries: [
        { package: 'force-pkg', output: { path: outputDir, force: true, gitignore: false } },
      ],
      config: null,
      cwd: tmpDir,
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('pkg content');
  }, 60000);

  it('throws on conflict without force', async () => {
    await installMockPackage('conflict-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await expect(
      actionExtract({
        entries: [{ package: 'conflict-pkg', output: { path: outputDir, gitignore: false } }],
        config: null,
        cwd: tmpDir,
      }),
    ).rejects.toThrow('Conflict');
  }, 60000);

  it('keep-existing skips files that already exist', async () => {
    await installMockPackage('keep-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await actionExtract({
      entries: [
        { package: 'keep-pkg', output: { path: outputDir, keepExisting: true, gitignore: false } },
      ],
      config: null,
      cwd: tmpDir,
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('user content');
  }, 60000);

  it('detects circular dependencies', async () => {
    await installMockPackage('circ-pkg', '1.0.0', { 'guide.md': 'content' }, tmpDir);

    const visited = new Set(['circ-pkg']);
    await expect(
      actionExtract({
        entries: [
          { package: 'circ-pkg', output: { path: path.join(tmpDir, 'output'), gitignore: false } },
        ],
        config: null,
        cwd: tmpDir,
        visitedPackages: visited,
      }),
    ).rejects.toThrow('Circular dependency');
  }, 60000);

  it('recursively extracts sub-package npmdata.sets from installed dependency', async () => {
    // Install a "dep" package
    await installMockPackage('recursive-dep', '1.0.0', { 'dep-file.md': '# Dep' }, tmpDir);
    // Install a "main" package that will have npmdata.sets pointing to recursive-dep
    await installMockPackage('recursive-main', '1.0.0', { 'main-file.md': '# Main' }, tmpDir);

    // Modify recursive-main's package.json in node_modules to include npmdata.sets
    const mainPkgPath = path.join(tmpDir, 'node_modules', 'recursive-main');
    const mainPkgJsonPath = path.join(mainPkgPath, 'package.json');
    const existingJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...existingJson,
        npmdata: {
          sets: [
            {
              package: 'recursive-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionExtract({
      entries: [
        {
          package: 'recursive-main',
          output: { path: outputDir, gitignore: false },
        },
      ],
      config: null,
      cwd: tmpDir,
    });

    // Should have extracted main-file.md AND recursively extracted dep-file.md
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'main-file.md'))).toBe(true);
  }, 90000);

  it('emits file-modified event on re-extraction with changed content', async () => {
    // First extraction
    await installMockPackage('modify-pkg', '1.0.0', { 'doc.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'modify-pkg', output: { path: outputDir, gitignore: false } }],
      config: null,
      cwd: tmpDir,
    });

    // Update the file in node_modules to simulate a new version with changed content
    const pkgFile = path.join(tmpDir, 'node_modules', 'modify-pkg', 'doc.md');
    fs.chmodSync(pkgFile, 0o644);
    fs.writeFileSync(pkgFile, '# v2 changed content');

    const events: string[] = [];
    await actionExtract({
      entries: [
        {
          package: 'modify-pkg',
          output: { path: outputDir, force: true, gitignore: false },
        },
      ],
      config: null,
      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('file-modified');
  }, 90000);

  it('creates symlinks when symlinks config is provided', async () => {
    await installMockPackage('symlink-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    const linkTarget = path.join(tmpDir, 'links');
    fs.mkdirSync(linkTarget, { recursive: true });

    await actionExtract({
      entries: [
        {
          package: 'symlink-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'docs/guide.md', target: path.relative(outputDir, linkTarget) }],
          },
        },
      ],
      config: null,
      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    // symlink should be created in linkTarget
    const linkPath = path.join(linkTarget, 'guide.md');
    expect(fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
  }, 90000);
});
