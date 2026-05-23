import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import { createMockGitRepo, installMockPackage } from '../fileset/test-utils';
import { ProgressEvent } from '../types';

import { actionCheck } from './action-check';
import { actionInstall } from './action-install';
import {
  LockfileData,
  readManagedFilesForDir,
  writeLockfile,
  writeManagedFilesForDir,
} from './lockfile';

describe('actionInstall', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-action-install-test-'));
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
    const result = await actionInstall({
      entries: [{ package: 'my-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/api.md'))).toBe(true);
  }, 60000);

  it('writes .filedist marker after extraction', async () => {
    await installMockPackage('marker-pkg', '1.0.0', { 'src/index.ts': 'export {}' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: 'marker-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const marker = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(marker.length).toBeGreaterThan(0);
    expect(marker[0].packageName).toBe('marker-pkg');
  }, 60000);

  it('tracks created symlinks in the marker file', async () => {
    await installMockPackage('symlink-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [
        {
          package: 'symlink-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'docs/*.md', target: 'links' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const marker = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(marker).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'docs/guide.md', kind: 'file' }),
        expect.objectContaining({ path: 'links/guide.md', kind: 'symlink' }),
      ]),
    );
  }, 60000);

  it('keeps unchanged symlinks and their original marker version across package bumps', async () => {
    await installMockPackage('symlink-bump-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output-bump');
    await actionInstall({
      entries: [
        {
          package: 'symlink-bump-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'docs/*.md', target: 'links' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const linkPath = path.join(outputDir, 'links', 'guide.md');
    const before = fs.lstatSync(linkPath);

    await installMockPackage('symlink-bump-pkg', '1.0.1', { 'docs/guide.md': '# Guide' }, tmpDir);
    await actionInstall({
      entries: [
        {
          package: 'symlink-bump-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'docs/*.md', target: 'links' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const after = fs.lstatSync(linkPath);
    const marker = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    const symlinkEntry = marker.find((entry) => entry.path === 'links/guide.md');

    expect(after.ino).toBe(before.ino);
    expect(symlinkEntry).toEqual(
      expect.objectContaining({
        path: 'links/guide.md',
        packageName: 'symlink-bump-pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
      }),
    );
  }, 60000);

  it('removes only managed stale symlinks during extract', async () => {
    await installMockPackage('symlink-stale-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    const linksDir = path.join(outputDir, 'links');
    fs.mkdirSync(linksDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs-guide-placeholder.txt'), 'placeholder');
    fs.symlinkSync('/dev/null', path.join(linksDir, 'stale-managed.md'));
    fs.symlinkSync('/dev/null', path.join(linksDir, 'stale-unmanaged.md'));
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'links/stale-managed.md',
        packageName: 'symlink-stale-pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: 'abc123',
        mutable: false,
      },
    ]);

    await actionInstall({
      entries: [
        {
          package: 'symlink-stale-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'docs/*.md', target: 'links' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(linksDir, 'stale-managed.md'))).toBe(false);
    expect(fs.existsSync(path.join(linksDir, 'stale-unmanaged.md'))).toBe(true);
    const marker = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(marker.some((entry) => entry.path === 'links/stale-managed.md')).toBe(false);
    expect(
      marker.some((entry) => entry.path === 'links/guide.md' && entry.kind === 'symlink'),
    ).toBe(true);
  }, 60000);

  it('dry-run reports without writing', async () => {
    await installMockPackage('dry-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [
        { package: 'dry-pkg', output: { path: outputDir, dryRun: true, gitignore: false } },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
    expect(
      readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir),
    ).toHaveLength(0);
  }, 60000);

  it('force overwrites unmanaged files', async () => {
    await installMockPackage('force-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await actionInstall({
      entries: [
        { package: 'force-pkg', output: { path: outputDir, force: true, gitignore: false } },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('pkg content');
  }, 60000);

  it('throws on conflict without force', async () => {
    await installMockPackage('conflict-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await expect(
      actionInstall({
        entries: [{ package: 'conflict-pkg', output: { path: outputDir, gitignore: false } }],

        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
      }),
    ).rejects.toThrow('Conflict');
  }, 60000);

  it('mutable skips files that already exist', async () => {
    await installMockPackage('keep-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await actionInstall({
      entries: [
        { package: 'keep-pkg', output: { path: outputDir, mutable: true, gitignore: false } },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('user content');
  }, 60000);

  it('force does not overwrite a file previously installed as mutable', async () => {
    await installMockPackage('force-mutable-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    // First install with mutable — user is allowed to modify the file
    await actionInstall({
      entries: [
        {
          package: 'force-mutable-pkg',
          output: { path: outputDir, mutable: true, gitignore: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // Simulate user modification
    fs.chmodSync(path.join(outputDir, 'guide.md'), 0o644);
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user modified content');

    // Second install with force — mutable files are always preserved regardless of force
    const events: string[] = [];
    await actionInstall({
      entries: [
        {
          package: 'force-mutable-pkg',
          output: { path: outputDir, force: true, gitignore: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e.type),
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('user modified content');
    expect(events).not.toContain('file-modified');
  }, 60000);

  it('keeps stale managed files on disk when noSync is enabled', async () => {
    await installMockPackage(
      'nosync-pkg',
      '1.0.0',
      { 'keep.md': '# Keep', 'stale.md': '# Stale' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output-nosync');
    await actionInstall({
      entries: [{ package: 'nosync-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const result = await actionInstall({
      entries: [
        {
          package: 'nosync-pkg',
          selector: { files: ['keep.md'] },
          output: { path: outputDir, gitignore: false, noSync: true },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.deleted).toBe(0);
    expect(fs.existsSync(path.join(outputDir, 'keep.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'stale.md'))).toBe(true);

    const marker = readManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir);
    expect(marker).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'keep.md' }),
        expect.objectContaining({ path: 'stale.md' }),
      ]),
    );
  }, 60000);

  it('deduplicates identical entries to avoid double extraction', async () => {
    await installMockPackage('circ-pkg', '1.0.0', { 'guide.md': 'content' }, tmpDir);

    // Passing the same entry twice should result in extraction happening only once
    const outputDir = path.join(tmpDir, 'output');
    const result = await actionInstall({
      entries: [
        { package: 'circ-pkg', output: { path: outputDir, gitignore: false } },
        { package: 'circ-pkg', output: { path: outputDir, gitignore: false } },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // Guide.md should be extracted once, not twice
    expect(result.added).toBe(1);
    expect(result.modified).toBe(0);
  }, 60000);

  it('recursively extracts sub-package filedist.sets from installed dependency', async () => {
    // Install a "dep" package
    await installMockPackage('recursive-dep', '1.0.0', { 'dep-file.md': '# Dep' }, tmpDir);
    // Install a "main" package that will have filedist.sets pointing to recursive-dep
    await installMockPackage('recursive-main', '1.0.0', { 'main-file.md': '# Main' }, tmpDir);

    // Modify recursive-main's package.json in node_modules to include filedist.sets
    const mainPkgPath = path.join(tmpDir, 'node_modules', 'recursive-main');
    const mainPkgYmlPath = path.join(mainPkgPath, '.filedist-package.yml');
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'recursive-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionInstall({
      entries: [
        {
          package: 'recursive-main',
          output: { path: outputDir, gitignore: false },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Should have extracted main-file.md AND recursively extracted dep-file.md
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'main-file.md'))).toBe(true);
    // dep-out path is relative to outputDir (path.join(outputConfig.path, depPath))
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'dep-file.md'))).toBe(true);
  }, 90000);

  it('extracts from git repositories, follows nested .filedistrc, and cleans .filedist-tmp afterwards', async () => {
    const childRepo = await createMockGitRepo(
      'extract-child',
      { 'child/data.json': '{"ok":true}' },
      tmpDir,
      { tag: 'v1.0.0' },
    );
    const parentRepo = await createMockGitRepo(
      'extract-parent',
      { 'docs/guide.md': '# Parent Guide' },
      tmpDir,
      {
        tag: 'v2.0.0',
        filedistConfig: {
          sets: [
            { output: { path: '.', gitignore: false } },
            {
              package: `git:${childRepo.repoUrl}@v1.0.0`,
              output: { path: 'nested', gitignore: false },
            },
          ],
        },
      },
    );

    const outputDir = path.join(tmpDir, 'git-output');
    const result = await actionInstall({
      entries: [
        {
          package: `git:${parentRepo.repoUrl}@v2.0.0`,
          output: { path: outputDir, gitignore: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.added).toBe(2);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'nested', 'child', 'data.json'))).toBe(true);
    // git clone temp dir is in the OS temp dir, not in the workspace

    const parentMarker = readManagedFilesForDir(
      path.join(tmpDir, '.filedist.lock'),
      tmpDir,
      outputDir,
    );
    const childMarker = readManagedFilesForDir(
      path.join(tmpDir, '.filedist.lock'),
      tmpDir,
      path.join(outputDir, 'nested'),
    );
    expect(parentMarker.map((entry) => entry.packageName)).toEqual(
      expect.arrayContaining([parentRepo.repoUrl]),
    );
    expect(childMarker.map((entry) => entry.packageName)).toEqual(
      expect.arrayContaining([childRepo.repoUrl]),
    );
  }, 90000);

  it('entry presets field filters which top-level entries are extracted', async () => {
    await installMockPackage('tl-docs-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('tl-data-pkg', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output-tl');

    // Extract only the entry tagged with 'docs'
    const result = await actionInstall({
      entries: [
        {
          package: 'tl-docs-pkg',
          presets: ['docs'],
          output: { path: path.join(outputDir, 'docs'), gitignore: false },
        },
        {
          package: 'tl-data-pkg',
          presets: ['data'],
          output: { path: path.join(outputDir, 'data'), gitignore: false },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Without presets filtering at the call site all entries are extracted
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data', 'data/sample.csv'))).toBe(true);
  }, 90000);

  it('selector.presets filters which nested filedist.sets are recursively extracted', async () => {
    // Install two nested packages, each representing a different preset
    await installMockPackage('nested-docs', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('nested-data', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    // Install a main package whose filedist.sets references both nested packages,
    // each tagged with a different preset
    await installMockPackage('preset-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);
    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'preset-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'nested-docs',
              presets: ['docs'],
              output: { path: 'nested', gitignore: false },
            },
            {
              package: 'nested-data',
              presets: ['data'],
              output: { path: 'nested', gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');

    // Extract with selector.presets: ['docs'] — only the docs nested set should be pulled.
    // preset-main has no self-referential set, so its own files (main.md) must NOT appear.
    await actionInstall({
      entries: [
        {
          package: 'preset-main',
          selector: { presets: ['docs'] },
          output: { path: outputDir, gitignore: false },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(outputDir, 'main.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'nested', 'docs', 'guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'nested', 'data', 'sample.csv'))).toBe(false);
  }, 90000);

  it('extracts self-referencing filedist.sets inline when selector.presets is active', async () => {
    // Simulates a self-installable (binpkg) data-package that declares which of its own files
    // belong to each preset via self-referencing filedist.sets entries.
    await installMockPackage(
      'self-ref-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        'data/sample.csv': 'a,b',
        'conf/settings.json': '{}',
      },
      tmpDir,
    );

    // Add self-referencing filedist.sets to the installed package's package.json
    const pkgYmlPath = path.join(tmpDir, 'node_modules', 'self-ref-pkg', '.filedist-package.yml');
    fs.writeFileSync(
      pkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              presets: ['docs'],
              selector: { files: ['docs/**'] },
              output: { path: '.', gitignore: false },
            },
            {
              presets: ['data'],
              selector: { files: ['data/**'] },
              output: { path: '.', gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');

    // Extracting with 'docs' preset should only pull docs/** via the self-ref set
    const result = await actionInstall({
      entries: [
        {
          package: 'self-ref-pkg',
          selector: { presets: ['docs'] },
          output: { path: outputDir, gitignore: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.added).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data', 'sample.csv'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'conf', 'settings.json'))).toBe(false);
  }, 90000);

  it('extracts self-referencing sets for multiple presets correctly', async () => {
    await installMockPackage(
      'multi-preset-pkg',
      '1.0.0',
      { 'docs/guide.md': '# Guide', 'data/sample.csv': 'a,b' },
      tmpDir,
    );

    const pkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'multi-preset-pkg',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      pkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              presets: ['docs'],
              selector: { files: ['docs/**'] },
              output: { path: '.', gitignore: false },
            },
            {
              presets: ['data'],
              selector: { files: ['data/**'] },
              output: { path: '.', gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');

    // Extracting with both presets should pull both file sets
    const result = await actionInstall({
      entries: [
        {
          package: 'multi-preset-pkg',
          selector: { presets: ['docs', 'data'] },
          output: { path: outputDir, gitignore: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.added).toBe(2);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data', 'sample.csv'))).toBe(true);
  }, 90000);

  it('throws when selector.presets does not match any set in the producer package', async () => {
    await installMockPackage('no-match-pkg', '1.0.0', { 'main.md': '# Main' }, tmpDir);
    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'no-match-pkg',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        { sets: [{ package: 'some-dep', presets: ['docs'], output: { path: '.' } }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    await expect(
      actionInstall({
        entries: [
          {
            package: 'no-match-pkg',
            selector: { presets: ['nonexistent'] },
            output: { path: outputDir, gitignore: false },
          },
        ],

        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
      }),
    ).rejects.toThrow('nonexistent');
  }, 60000);

  it('emits file-modified event on re-extraction with changed content', async () => {
    // First extraction
    await installMockPackage('modify-pkg', '1.0.0', { 'doc.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: 'modify-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Update the file in node_modules to simulate a new version with changed content
    const pkgFile = path.join(tmpDir, 'node_modules', 'modify-pkg', 'doc.md');
    fs.chmodSync(pkgFile, 0o644);
    fs.writeFileSync(pkgFile, '# v2 changed content');

    const events: string[] = [];
    await actionInstall({
      entries: [
        {
          package: 'modify-pkg',
          output: { path: outputDir, force: true, gitignore: false },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('file-modified');
    expect(fs.readFileSync(path.join(outputDir, 'doc.md'), 'utf8')).toBe('# v2 changed content');
  }, 90000);

  it('extracts an example-style package and verifies exported files and symlinks', async () => {
    await installMockPackage(
      'example-files-package',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        'data/users-dataset/user1.json': '{"id":1}',
        'data/users-dataset/user2.json': '{"id":2}',
      },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');

    await actionInstall({
      entries: [
        {
          package: 'example-files-package',
          selector: { files: ['docs/**', 'data/**'] },
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'data/**', target: 'data-symlink' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const exportedGuide = path.join(outputDir, 'docs', 'guide.md');
    const exportedUser1 = path.join(outputDir, 'data', 'users-dataset', 'user1.json');
    const exportedUser2 = path.join(outputDir, 'data', 'users-dataset', 'user2.json');
    const dataSymlinkDir = path.join(outputDir, 'data-symlink');
    const datasetLink = path.join(dataSymlinkDir, 'users-dataset');
    const user1Link = path.join(dataSymlinkDir, 'user1.json');
    const user2Link = path.join(dataSymlinkDir, 'user2.json');

    expect(fs.readFileSync(exportedGuide, 'utf8')).toBe('# Guide');
    expect(fs.readFileSync(exportedUser1, 'utf8')).toBe('{"id":1}');
    expect(fs.readFileSync(exportedUser2, 'utf8')).toBe('{"id":2}');

    expect(fs.lstatSync(datasetLink).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(user1Link).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(user2Link).isSymbolicLink()).toBe(true);
    expect(path.resolve(dataSymlinkDir, fs.readlinkSync(datasetLink))).toBe(
      path.join(outputDir, 'data', 'users-dataset'),
    );
    expect(path.resolve(dataSymlinkDir, fs.readlinkSync(user1Link))).toBe(exportedUser1);
    expect(path.resolve(dataSymlinkDir, fs.readlinkSync(user2Link))).toBe(exportedUser2);

    const checkResult = await actionCheck({
      entries: [
        {
          package: 'example-files-package@1.0.0',
          selector: { files: ['docs/**', 'data/**'] },
          output: {
            path: outputDir,
            symlinks: [{ source: 'data/**', target: 'data-symlink' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(checkResult.missing).toHaveLength(0);
    expect(checkResult.conflict).toHaveLength(0);
    expect(checkResult.extra).toHaveLength(0);
  }, 90000);

  it('throws when entry is missing package field', async () => {
    await expect(
      actionInstall({
        entries: [{ package: '', output: { path: 'out' } }],

        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
      }),
    ).rejects.toThrow('"package" field');
  });

  it('defaults output.path to cwd when omitted', async () => {
    await installMockPackage('default-out-pkg', '1.0.0', { 'file.md': '# hi' }, tmpDir);
    const result = await actionInstall({
      entries: [{ package: 'default-out-pkg' }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.added).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'file.md'))).toBe(true);
  }, 60_000);

  it('returns zero counts for empty entries', async () => {
    const result = await actionInstall({
      entries: [],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(0);
  }, 30000);

  it('managed=false skips conflicting unmanaged files instead of throwing', async () => {
    await installMockPackage('unmanaged-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    // Should not throw even though guide.md is an unmanaged conflict
    await expect(
      actionInstall({
        entries: [
          {
            package: 'unmanaged-pkg',
            output: { path: outputDir, managed: false, gitignore: false },
          },
        ],

        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
      }),
    ).resolves.toBeDefined();

    // managed=false file should remain untouched
    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('user content');
  }, 60000);

  it('emits package-start and package-end progress events', async () => {
    await installMockPackage('events-pkg', '1.0.0', { 'readme.md': '# Readme' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    const events: string[] = [];

    await actionInstall({
      entries: [{ package: 'events-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
    expect(events).toContain('package-end');
    expect(events).toContain('file-added');
  }, 60000);

  it('emits managed and gitignore metadata on file progress events', async () => {
    await installMockPackage('event-flags-pkg', '1.0.0', { 'readme.md': '# Readme' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output-flags');
    const events: ProgressEvent[] = [];

    await actionInstall({
      entries: [{ package: 'event-flags-pkg', output: { path: outputDir } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e),
    });

    const fileAdded = events.find((e) => e.type === 'file-added');
    expect(fileAdded).toMatchObject({
      type: 'file-added',
      file: 'readme.md',
      managed: true,
      gitignore: true,
    });
  }, 60000);

  it('emits file-skipped event when file is unchanged on re-extraction', async () => {
    await installMockPackage('skip-pkg', '1.0.0', { 'doc.md': '# Doc' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');

    // First extraction
    await actionInstall({
      entries: [{ package: 'skip-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const events: string[] = [];
    // Second extraction without changes — file should be skipped
    await actionInstall({
      entries: [{ package: 'skip-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('file-skipped');
  }, 90000);

  it('extracts multiple entries in a single call', async () => {
    await installMockPackage('multi-a', '1.0.0', { 'a.md': '# A' }, tmpDir);
    await installMockPackage('multi-b', '1.0.0', { 'b.md': '# B' }, tmpDir);

    const outputA = path.join(tmpDir, 'out-a');
    const outputB = path.join(tmpDir, 'out-b');

    const result = await actionInstall({
      entries: [
        { package: 'multi-a', output: { path: outputA, gitignore: false } },
        { package: 'multi-b', output: { path: outputB, gitignore: false } },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputA, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputB, 'b.md'))).toBe(true);
  }, 90000);

  it('does not create symlinks when dryRun is true', async () => {
    await installMockPackage('dryrun-sym-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    const linkTarget = path.join(tmpDir, 'links');
    fs.mkdirSync(linkTarget, { recursive: true });

    await actionInstall({
      entries: [
        {
          package: 'dryrun-sym-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            dryRun: true,
            symlinks: [{ source: 'docs/guide.md', target: path.relative(outputDir, linkTarget) }],
          },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // No file should be written in dryRun mode
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
    // No symlink should be created in dryRun mode
    expect(fs.readdirSync(linkTarget)).toHaveLength(0);
  }, 60000);

  it('deletes files removed from package on re-extraction and emits file-deleted event', async () => {
    // First extraction: package has two files
    await installMockPackage(
      'delete-pkg',
      '1.0.0',
      { 'keep.md': '# Keep', 'remove.md': '# Remove' },
      tmpDir,
    );
    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: 'delete-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(outputDir, 'remove.md'))).toBe(true);

    // Update the installed package to remove remove.md
    const pkgDir = path.join(tmpDir, 'node_modules', 'delete-pkg');
    fs.rmSync(path.join(pkgDir, 'remove.md'));

    const events: string[] = [];
    const result = await actionInstall({
      entries: [{ package: 'delete-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e.type),
    });

    expect(result.deleted).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'remove.md'))).toBe(false);
    expect(events).toContain('file-deleted');
  }, 90000);

  it('uses explicit selector and contentReplacements when provided', async () => {
    await installMockPackage(
      'selector-pkg',
      '1.0.0',
      { 'docs/guide.md': 'Hello REPLACE_ME world', 'src/index.ts': 'export {}' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionInstall({
      entries: [
        {
          package: 'selector-pkg',
          selector: { files: ['docs/**'] },
          output: {
            path: outputDir,
            gitignore: false,
            contentReplacements: [{ files: 'docs/**', match: 'REPLACE_ME', replace: 'REPLACED' }],
          },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Only docs files selected by selector
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'src/index.ts'))).toBe(false);
    // Content replacement should have replaced REPLACE_ME with REPLACED
    expect(fs.readFileSync(path.join(outputDir, 'docs/guide.md'), 'utf8')).toContain('REPLACED');
    expect(fs.readFileSync(path.join(outputDir, 'docs/guide.md'), 'utf8')).not.toContain(
      'REPLACE_ME',
    );
  }, 60000);

  it('recursively merges selector and output configs across dependency levels', async () => {
    // A dependency package with files in docs/ (selector target) and src/ (excluded)
    await installMockPackage(
      'merge-dep',
      '1.0.0',
      {
        'docs/guide.md': 'PARENT_TOKEN DEP_TOKEN content',
        'src/index.ts': 'should be excluded by dep selector',
      },
      tmpDir,
    );

    // A main package that lists merge-dep in its filedist.sets
    await installMockPackage('merge-main', '1.0.0', { 'readme.md': 'main file' }, tmpDir);

    // Patch main package.json in node_modules to declare filedist.sets for merge-dep
    const mainPkgYmlPath = path.join(tmpDir, 'node_modules', 'merge-main', '.filedist-package.yml');
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'merge-dep',
              // dep-level selector: restrict to docs/** only
              selector: { files: ['docs/**'] },
              output: {
                path: 'dep-out',
                gitignore: false,
                // dep-level replacement: DEP_TOKEN → dep-replaced
                contentReplacements: [{ files: '**', match: 'DEP_TOKEN', replace: 'dep-replaced' }],
              },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');

    // Pre-create an unmanaged file in the dep's computed output location.
    // Without force cascading this would throw a conflict error.
    fs.mkdirSync(path.join(outputDir, 'dep-out', 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'dep-out', 'docs', 'guide.md'),
      'unmanaged pre-existing content',
    );

    await actionInstall({
      entries: [
        {
          package: 'merge-main',
          output: {
            path: outputDir,
            gitignore: false,
            // force: true must cascade to sub-packages (parent takes precedence)
            force: true,
            // parent-level replacement: PARENT_TOKEN → parent-replaced
            contentReplacements: [
              { files: '**', match: 'PARENT_TOKEN', replace: 'parent-replaced' },
            ],
          },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Main package file extracted to outputDir
    expect(fs.existsSync(path.join(outputDir, 'readme.md'))).toBe(true);

    // Dep file: path composed as outputDir/dep-out/docs/guide.md
    const depFile = path.join(outputDir, 'dep-out', 'docs', 'guide.md');
    expect(fs.existsSync(depFile)).toBe(true);

    // Dep selector must have excluded src/index.ts
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'src', 'index.ts'))).toBe(false);

    // Both contentReplacements must have been applied (parent's + dep's merged)
    const content = fs.readFileSync(depFile, 'utf8');
    expect(content).toContain('parent-replaced');
    expect(content).toContain('dep-replaced');
    expect(content).not.toContain('PARENT_TOKEN');
    expect(content).not.toContain('DEP_TOKEN');
  }, 90000);

  it('rolls back newly created files when an error occurs mid-extraction', async () => {
    await installMockPackage('rollback-pkg', '1.0.0', { 'file.md': 'content' }, tmpDir);
    await installMockPackage('bad-pkg', '1.0.0', { 'conflict.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    // Pre-create an unmanaged conflict for the second entry to trigger error after first succeeds
    fs.writeFileSync(path.join(outputDir, 'conflict.md'), 'user content');

    await expect(
      actionInstall({
        entries: [
          { package: 'rollback-pkg', output: { path: outputDir, gitignore: false } },
          { package: 'bad-pkg', output: { path: outputDir, gitignore: false } },
        ],

        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
      }),
    ).rejects.toThrow('Conflict');

    // Files written by the first entry should have been rolled back
    expect(fs.existsSync(path.join(outputDir, 'file.md'))).toBe(false);
  }, 90000);

  it('parent dryRun cascades and prevents dep sub-package from writing files', async () => {
    await installMockPackage('dryrun-dep', '1.0.0', { 'dep.md': '# Dep' }, tmpDir);
    await installMockPackage('dryrun-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'dryrun-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'dryrun-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    // parent dryRun: true — no files written for main OR dep
    await actionInstall({
      entries: [
        {
          package: 'dryrun-main',
          output: { path: outputDir, gitignore: false, dryRun: true },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(outputDir, 'main.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'dep.md'))).toBe(false);
  }, 90000);

  it('parent mutable cascades and preserves existing files in dep output', async () => {
    await installMockPackage('keepex-dep', '1.0.0', { 'dep.md': 'new content from pkg' }, tmpDir);
    await installMockPackage('keepex-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'keepex-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'keepex-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    // Pre-create a file in the dep output location — with mutable it should NOT be overwritten
    fs.mkdirSync(path.join(outputDir, 'dep-out'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'existing user content');

    // parent mutable: true cascades to dep
    await actionInstall({
      entries: [
        {
          package: 'keepex-main',
          output: { path: outputDir, gitignore: false, mutable: true },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // dep.md should remain unchanged (kept, not overwritten)
    expect(fs.readFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'utf8')).toBe(
      'existing user content',
    );
  }, 90000);

  it('dep-level force is used when parent does not set force', async () => {
    await installMockPackage('depforce-pkg', '1.0.0', { 'dep.md': 'pkg content' }, tmpDir);
    await installMockPackage('depforce-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'depforce-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'depforce-pkg',
              // dep declares its own force: true; parent does not set force at all
              output: { path: 'dep-out', gitignore: false, force: true },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    // Pre-create an unmanaged file — dep's own force: true should allow overwriting
    fs.mkdirSync(path.join(outputDir, 'dep-out'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'unmanaged old content');

    // Parent has no force set; dep's force: true is preserved via `undefined ?? true`
    await actionInstall({
      entries: [
        {
          package: 'depforce-main',
          output: { path: outputDir, gitignore: false },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.readFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'utf8')).toBe('pkg content');
  }, 90000);

  it('parent managed=false cascades to dep and dep files are writable', async () => {
    await installMockPackage('unmngcasc-dep', '1.0.0', { 'dep.md': 'dep content' }, tmpDir);
    await installMockPackage('unmngcasc-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'unmngcasc-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        { sets: [{ package: 'unmngcasc-dep', output: { path: 'dep-out', gitignore: false } }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [
        {
          package: 'unmngcasc-main',
          output: { path: outputDir, gitignore: false, managed: false },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const depFile = path.join(outputDir, 'dep-out', 'dep.md');
    expect(fs.existsSync(depFile)).toBe(true);
    // parent managed=false must cascade: dep files should not be made read-only
    const { mode } = fs.statSync(depFile);
    expect(mode & 0o200).toBeGreaterThan(0); // owner write bit must be set
  }, 90000);

  it('dep-level managed=false preserved when parent does not set managed', async () => {
    await installMockPackage('unmngdep-pkg', '1.0.0', { 'dep.md': 'dep content' }, tmpDir);
    await installMockPackage('unmngdep-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'unmngdep-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'unmngdep-pkg',
              // dep declares its own managed: false; parent does not set managed at all
              output: { path: 'dep-out', gitignore: false, managed: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    // parent leaves unmanaged undefined — dep's own value must survive via `undefined ?? true`
    await actionInstall({
      entries: [{ package: 'unmngdep-main', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const depFile = path.join(outputDir, 'dep-out', 'dep.md');
    expect(fs.existsSync(depFile)).toBe(true);
    const { mode } = fs.statSync(depFile);
    expect(mode & 0o200).toBeGreaterThan(0); // dep's managed=false must be preserved
  }, 90000);

  it('parent gitignore: false cascades to dep and suppresses .gitignore in dep output', async () => {
    await installMockPackage('gitcasc-dep', '1.0.0', { 'dep.md': 'dep content' }, tmpDir);
    await installMockPackage('gitcasc-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'gitcasc-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'gitcasc-dep',
              // dep does NOT set gitignore (defaults to creating .gitignore)
              output: { path: 'dep-out' },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [
        // parent explicitly disables gitignore — must cascade to dep
        { package: 'gitcasc-main', output: { path: outputDir, gitignore: false } },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // dep output should NOT contain a .gitignore (parent gitignore: false cascaded)
    expect(fs.existsSync(path.join(outputDir, 'dep-out', '.gitignore'))).toBe(false);
  }, 90000);

  it('symlinks from both parent and dep levels are all created', async () => {
    await installMockPackage('symsub-dep', '1.0.0', { 'dep-docs/dep.md': '# Dep Doc' }, tmpDir);
    await installMockPackage('symsub-main', '1.0.0', { 'main-docs/main.md': '# Main Doc' }, tmpDir);

    const depOutRelative = 'dep-out';
    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'symsub-main',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'symsub-dep',
              output: {
                path: depOutRelative,
                gitignore: false,
                // dep declares its own symlink
                symlinks: [{ source: 'dep-docs/dep.md', target: '../dep-links' }],
              },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const mainLinksDir = path.join(tmpDir, 'main-links');
    fs.mkdirSync(mainLinksDir, { recursive: true });

    await actionInstall({
      entries: [
        {
          package: 'symsub-main',
          output: {
            path: outputDir,
            gitignore: false,
            // parent declares its own symlink for main-docs/main.md
            symlinks: [
              { source: 'main-docs/main.md', target: path.relative(outputDir, mainLinksDir) },
            ],
          },
        },
      ],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // main package file and its symlink
    expect(fs.existsSync(path.join(outputDir, 'main-docs/main.md'))).toBe(true);
    const mainLinkPath = path.join(mainLinksDir, 'main.md');
    expect(fs.existsSync(mainLinkPath) || fs.lstatSync(mainLinkPath).isSymbolicLink()).toBe(true);

    // dep file
    const depDocPath = path.join(outputDir, depOutRelative, 'dep-docs/dep.md');
    expect(fs.existsSync(depDocPath)).toBe(true);
    // dep symlink: target '../dep-links' is relative to dep-out outputDir (outputDir/dep-out)
    const depLinkPath = path.join(outputDir, 'dep-links', 'dep.md');
    expect(fs.existsSync(depLinkPath) || fs.lstatSync(depLinkPath).isSymbolicLink()).toBe(true);
  }, 90000);

  it('three-level deep recursion composes paths correctly at each hop', async () => {
    await installMockPackage('level3-pkg', '1.0.0', { 'deep.md': '# Deep' }, tmpDir);
    await installMockPackage('level2-pkg', '1.0.0', { 'mid.md': '# Mid' }, tmpDir);
    await installMockPackage('level1-pkg', '1.0.0', { 'top.md': '# Top' }, tmpDir);

    // level2 depends on level3
    const l2PkgYmlPath = path.join(tmpDir, 'node_modules', 'level2-pkg', '.filedist-package.yml');
    fs.writeFileSync(
      l2PkgYmlPath,
      yaml.dump(
        { sets: [{ package: 'level3-pkg', output: { path: 'l3', gitignore: false } }] },
        { indent: 2 },
      ),
    );

    // level1 depends on level2
    const l1PkgYmlPath = path.join(tmpDir, 'node_modules', 'level1-pkg', '.filedist-package.yml');
    fs.writeFileSync(
      l1PkgYmlPath,
      yaml.dump(
        { sets: [{ package: 'level2-pkg', output: { path: 'l2', gitignore: false } }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: 'level1-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // level1 files at outputDir/
    expect(fs.existsSync(path.join(outputDir, 'top.md'))).toBe(true);
    // level2 files at outputDir/l2/
    expect(fs.existsSync(path.join(outputDir, 'l2', 'mid.md'))).toBe(true);
    // level3 files at outputDir/l2/l3/
    expect(fs.existsSync(path.join(outputDir, 'l2', 'l3', 'deep.md'))).toBe(true);
  }, 90000);

  it('does not extract LICENSE file by default', async () => {
    await installMockPackage(
      'license-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        LICENSE: 'MIT License',
      },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: 'license-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'LICENSE'))).toBe(false);
  }, 60000);

  it('verbose mode logs extract steps without errors', async () => {
    await installMockPackage('verbose-extract-pkg', '1.0.0', { 'guide.md': '# Guide' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output-verbose');

    const result = await actionInstall({
      entries: [{ package: 'verbose-extract-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      verbose: true,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'guide.md'))).toBe(true);
  }, 60000);

  it('verbose mode logs re-extraction (skip/modify) and deferred deletes', async () => {
    await installMockPackage(
      'verbose-reextract-pkg',
      '1.0.0',
      { 'keep.md': '# Keep', 'del.md': '# Delete' },
      tmpDir,
    );
    const outputDir = path.join(tmpDir, 'output-verbose-re');

    // First extraction with verbose
    await actionInstall({
      entries: [
        { package: 'verbose-reextract-pkg', output: { path: outputDir, gitignore: false } },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      verbose: true,
    });

    // Remove 'del.md' from the package to trigger a deferred delete on re-extract
    const pkgDir = path.join(tmpDir, 'node_modules', 'verbose-reextract-pkg');
    const delFile = path.join(pkgDir, 'del.md');
    fs.chmodSync(delFile, 0o644);
    fs.rmSync(delFile);

    // Modify 'keep.md' to trigger a modify
    const keepFile = path.join(pkgDir, 'keep.md');
    fs.chmodSync(keepFile, 0o644);
    fs.writeFileSync(keepFile, '# Keep v2');

    const events: string[] = [];
    const result = await actionInstall({
      entries: [
        {
          package: 'verbose-reextract-pkg',
          output: { path: outputDir, force: true, gitignore: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      verbose: true,
      onProgress: (e) => events.push(e.type),
    });

    expect(result.deleted).toBeGreaterThan(0);
    expect(result.modified).toBeGreaterThan(0);
    expect(events).toContain('file-deleted');
    expect(events).toContain('file-modified');
  }, 90000);

  it('verbose recursive extract logs recursion message', async () => {
    await installMockPackage('verbose-dep', '1.0.0', { 'dep.md': '# Dep' }, tmpDir);
    await installMockPackage('verbose-main-rec', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'verbose-main-rec',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        { sets: [{ package: 'verbose-dep', output: { path: 'dep-out', gitignore: false } }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output-verbose-rec');
    const result = await actionInstall({
      entries: [{ package: 'verbose-main-rec', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      verbose: true,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'main.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'dep.md'))).toBe(true);
  }, 90000);

  it('verbose mode logs warning before throwing conflict error and triggers rollback', async () => {
    await installMockPackage(
      'conflict-verbose-a',
      '1.0.0',
      { 'file-a.md': 'pkg content A' },
      tmpDir,
    );
    await installMockPackage(
      'conflict-verbose-b',
      '1.0.0',
      { 'conflict.md': 'pkg content B' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output-conflict-verbose');
    fs.mkdirSync(outputDir, { recursive: true });
    // Pre-create an unmanaged conflict file for the second entry
    fs.writeFileSync(path.join(outputDir, 'conflict.md'), 'user unmanaged content');

    await expect(
      actionInstall({
        entries: [
          { package: 'conflict-verbose-a', output: { path: outputDir, gitignore: false } },
          { package: 'conflict-verbose-b', output: { path: outputDir, gitignore: false } },
        ],
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        verbose: true,
      }),
    ).rejects.toThrow('Conflict');

    // Files from the first entry should have been rolled back
    expect(fs.existsSync(path.join(outputDir, 'file-a.md'))).toBe(false);
    // The user's unmanaged file should remain
    expect(fs.existsSync(path.join(outputDir, 'conflict.md'))).toBe(true);
  }, 90000);
});

describe('actionInstall — lock file', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-action-install-lock-test-'));
  });

  afterEach(() => {
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

  it('writes .filedist.lock after a successful install', async () => {
    const PKG = 'lock-write-pkg';
    await installMockPackage(PKG, '1.2.3', { 'data/file.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: PKG, output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    const lockPath = path.join(tmpDir, '.filedist.lock');
    expect(fs.existsSync(lockPath)).toBe(true);
    const lockData = yaml.load(fs.readFileSync(lockPath, 'utf8')) as LockfileData;
    expect(lockData.version).toBe(1);
    expect(lockData.packages[PKG]).toBeDefined();
    expect(lockData.packages[PKG]).toBe('1.2.3');
  }, 60_000);

  it('does not write .filedist.lock on dry-run', async () => {
    const PKG = 'lock-dryrun-pkg';
    await installMockPackage(PKG, '1.0.0', { 'data/file.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: PKG, output: { path: outputDir, gitignore: false, dryRun: true } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(fs.existsSync(path.join(tmpDir, '.filedist.lock'))).toBe(false);
  }, 60_000);

  it('throws when --frozen-lockfile is set but .filedist.lock is missing', async () => {
    const PKG = 'lock-frozen-missing-pkg';
    await installMockPackage(PKG, '1.0.0', { 'data/file.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    await expect(
      actionInstall({
        entries: [{ package: PKG, output: { path: outputDir, gitignore: false } }],
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        frozenLockfile: true,
      }),
    ).rejects.toThrow('.filedist.lock');
  }, 60_000);

  it('uses pinned version from lock file when frozenLockfile is true', async () => {
    const PKG = 'lock-frozen-use-pkg';
    // Install version 1.0.0 and create a lock file pinning it
    await installMockPackage(PKG, '1.0.0', { 'data/file.txt': 'v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    // First run: normal install to create lock file
    await actionInstall({
      entries: [{ package: PKG, output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(fs.existsSync(path.join(tmpDir, '.filedist.lock'))).toBe(true);
    // Second run with frozenLockfile: should succeed using pinned version
    await actionInstall({
      entries: [{ package: PKG, output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      frozenLockfile: true,
    });
    expect(fs.existsSync(path.join(outputDir, 'data/file.txt'))).toBe(true);
  }, 60_000);

  it('does not update lock file when frozenLockfile is true', async () => {
    const PKG = 'lock-frozen-noupdate-pkg';
    await installMockPackage(PKG, '2.0.0', { 'data/file.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    // Create a minimal lock file manually
    const lockPath = path.join(tmpDir, '.filedist.lock');
    writeLockfile(path.join(tmpDir, '.filedist.lock'), {
      version: 1,
      packages: { [PKG]: '2.0.0' },
    });
    const originalContent = fs.readFileSync(lockPath, 'utf8');
    await actionInstall({
      entries: [{ package: PKG, output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      frozenLockfile: true,
    });
    // Lock file should be unchanged
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(originalContent);
  }, 60_000);

  it('records transitive sub-package dependencies in the lock file', async () => {
    // dep package installed in node_modules
    const DEP = 'lock-trans-dep';
    const MAIN = 'lock-trans-main';
    await installMockPackage(DEP, '2.1.0', { 'dep.md': '# Dep' }, tmpDir);
    await installMockPackage(MAIN, '1.0.0', { 'main.md': '# Main' }, tmpDir);

    // Patch main's package.json to declare a filedist.sets referencing dep
    const mainPkgYmlPath = path.join(tmpDir, 'node_modules', MAIN, '.filedist-package.yml');
    fs.writeFileSync(
      mainPkgYmlPath,
      yaml.dump(
        { sets: [{ package: DEP, output: { path: 'dep-out', gitignore: false } }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionInstall({
      entries: [{ package: MAIN, output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const lockPath = path.join(tmpDir, '.filedist.lock');
    expect(fs.existsSync(lockPath)).toBe(true);
    const lockData = yaml.load(fs.readFileSync(lockPath, 'utf8')) as LockfileData;

    // Both the top-level package and its transitive sub-dependency must be locked
    expect(lockData.packages[MAIN]).toBeDefined();
    expect(lockData.packages[MAIN]).toBe('1.0.0');
    expect(lockData.packages[DEP]).toBeDefined();
    expect(lockData.packages[DEP]).toBe('2.1.0');
  }, 90_000);

  it('throws when lockfile is corrupt and force is NOT set', async () => {
    const PKG = 'lock-corrupt-noforce-pkg';
    await installMockPackage(PKG, '1.0.0', { 'data/file.txt': 'hello' }, tmpDir);
    const lockPath = path.join(tmpDir, '.filedist.lock');
    // Write valid YAML structure but with a tampered checksum
    fs.writeFileSync(lockPath, yaml.dump({ version: 1, packages: {}, checksum: 'deadbeef' }));

    const outputDir = path.join(tmpDir, 'output');
    await expect(
      actionInstall({
        entries: [{ package: PKG, output: { path: outputDir, gitignore: false } }],
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
      }),
    ).rejects.toThrow();
  }, 60_000);

  it('recreates corrupt lockfile from scratch and warns when force=true', async () => {
    const PKG = 'lock-corrupt-force-pkg';
    await installMockPackage(PKG, '1.0.0', { 'data/file.txt': 'hello' }, tmpDir);
    const lockPath = path.join(tmpDir, '.filedist.lock');
    // Tampered checksum triggers corruption error
    fs.writeFileSync(lockPath, yaml.dump({ version: 1, packages: {}, checksum: 'deadbeef' }));

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const outputDir = path.join(tmpDir, 'output');

    await actionInstall({
      entries: [{ package: PKG, output: { path: outputDir, gitignore: false, force: true } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('corrupt'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('recreated from scratch'));
    const recreatedLockData = yaml.load(fs.readFileSync(lockPath, 'utf8')) as LockfileData;
    expect(recreatedLockData.version).toBe(1);
    expect(recreatedLockData.packages[PKG]).toBeDefined();
    warnSpy.mockRestore();
  }, 60_000);
});

describe('actionInstall — frozenLockfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-install-frozen-'));
  });

  afterEach(() => {
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

  it('uses lockfile sets instead of caller entries when frozenLockfile=true', async () => {
    await installMockPackage('frozen-pkg-a', '1.0.0', { 'a.md': '# A' }, tmpDir);
    await installMockPackage('frozen-pkg-b', '1.0.0', { 'b.md': '# B' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');

    // Normal install with pkg-a — writes lockfile.sets=[pkg-a]
    await actionInstall({
      entries: [{ package: 'frozen-pkg-a', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(fs.existsSync(path.join(outputDir, 'a.md'))).toBe(true);

    // Frozen install with pkg-b passed as entries — lockfile sets (pkg-a) must win
    await actionInstall({
      entries: [{ package: 'frozen-pkg-b', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      frozenLockfile: true,
    });

    // pkg-a file is still present (lockfile set used), pkg-b was ignored
    expect(fs.existsSync(path.join(outputDir, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'b.md'))).toBe(false);
  }, 90_000);

  it('fails when frozenLockfile=true and no lockfile exists', async () => {
    const outputDir = path.join(tmpDir, 'out');
    await expect(
      actionInstall({
        entries: [{ package: 'any-pkg', output: { path: outputDir } }],
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        frozenLockfile: true,
      }),
    ).rejects.toThrow('.filedist.lock');
  });

  it('fails when frozenLockfile=true and managed files differ from lockfile', async () => {
    await installMockPackage('frozen-validate-pkg', '1.0.0', { 'file.md': '# file' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');

    // Normal install — writes lockfile with files
    await actionInstall({
      entries: [{ package: 'frozen-validate-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Manually add an extra untracked file to the output dir, then forcibly update the marker
    // so the lockfile files list diverges from what a fresh resolve would produce
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'file.md',
        packageName: 'frozen-validate-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'aaa',
        mutable: false,
      },
      {
        path: 'ghost.md',
        packageName: 'frozen-validate-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'bbb',
        mutable: false,
      },
    ]);

    // Frozen install must detect the discrepancy and throw
    await expect(
      actionInstall({
        entries: [
          { package: 'frozen-validate-pkg', output: { path: outputDir, gitignore: false } },
        ],
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        frozenLockfile: true,
      }),
    ).rejects.toThrow();
  }, 90_000);
});
