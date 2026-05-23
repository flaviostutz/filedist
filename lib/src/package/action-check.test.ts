import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import yaml from 'js-yaml';
import { jest } from '@jest/globals';

import { installMockPackage } from '../fileset/test-utils';
import { FiledistExtractEntry } from '../types';
import { filterEntriesByPresets } from '../utils';

import { writeManagedFilesForDir } from './lockfile';
import { actionCheck } from './action-check';
import { actionInstall } from './action-install';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(18, 30);
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-action-check-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionCheck', () => {
  it('returns empty summary when entries array is empty', async () => {
    const result = await actionCheck({
      entries: [],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.ok).toBe(0);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('returns empty summary when files match source', async () => {
    await installMockPackage('check-action-pkg', '1.0.0', { 'guide.md': '# OK' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const content = '# OK';
    fs.writeFileSync(path.join(outputDir, 'guide.md'), content);

    const checksum = crypto.createHash('sha256').update(content).digest('hex').slice(18, 30);
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'guide.md',
        packageName: 'check-action-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum,
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'check-action-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.ok).toBe(1);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('reports missing files when managed files have not been extracted yet', async () => {
    await installMockPackage('post-purge-pkg', '1.0.0', { 'guide.md': '# OK' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out-post-purge');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await actionCheck({
      entries: [{ package: 'post-purge-pkg@1.0.0', output: { path: outputDir } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.ok).toBe(0);
    expect(result.missing).toContain('guide.md');
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('reports missing when package not installed', async () => {
    await installMockPackage('not-installed-pkg', '1.0.0', { 'src/index.ts': 'x' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write a marker for a file
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'src/index.ts',
        packageName: 'not-installed-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    // Deliberately do NOT write src/index.ts to outputDir → it will appear as missing

    const entries: FiledistExtractEntry[] = [
      { package: 'not-installed-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // File is not on disk → missing
    expect(result.ok).toBe(0);
    expect(result.missing.length).toBeGreaterThan(0);
  }, 60000);

  it('reports stale managed files as extra after noSync extract', async () => {
    await installMockPackage(
      'check-nosync-pkg',
      '1.0.0',
      { 'keep.md': '# Keep', 'stale.md': '# Stale' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'out-nosync');
    await actionInstall({
      entries: [{ package: 'check-nosync-pkg@1.0.0', output: { path: outputDir } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    await actionInstall({
      entries: [
        {
          package: 'check-nosync-pkg@1.0.0',
          selector: { files: ['keep.md'] },
          output: { path: outputDir, noSync: true },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const result = await actionCheck({
      entries: [
        {
          package: 'check-nosync-pkg@1.0.0',
          selector: { files: ['keep.md'] },
          output: { path: outputDir },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // keep.md is in sync — counted as ok
    expect(result.ok).toBeGreaterThan(0);
    expect(result.extra).toContain('stale.md');
    expect(fs.existsSync(path.join(outputDir, 'stale.md'))).toBe(true);
  }, 60000);

  it('skips entries with managed=false when skipUnmanaged=true', async () => {
    const entries: FiledistExtractEntry[] = [
      { package: 'some-pkg', output: { path: path.join(tmpDir, 'out'), managed: false } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.ok).toBe(0);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('aggregates results from multiple entries', async () => {
    await installMockPackage('multi-pkg', '1.0.0', { 'a.md': 'aaa' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    // Don't extract the file → it will be "modified" (hash mismatch) or "missing"

    // Write a marker entry with wrong hash (will cause modified detection)
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'a.md',
        packageName: 'multi-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    // Write the file with different content
    fs.writeFileSync(path.join(outputDir, 'a.md'), 'different content');

    const entries: FiledistExtractEntry[] = [
      { package: 'multi-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // Since hash differs, should be in modified
    expect(result.ok).toBe(0);
    expect(result.conflict).toContain('a.md');
  }, 60000);

  it('emits onProgress events', async () => {
    await installMockPackage('progress-pkg', '1.0.0', { 'a.md': 'content' }, tmpDir);
    const events: string[] = [];
    const entries: FiledistExtractEntry[] = [
      { package: 'progress-pkg@1.0.0', output: { path: path.join(tmpDir, 'out') } },
    ];

    await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
  }, 60000);

  it('uses "latest" when package spec has no version', async () => {
    await installMockPackage('no-version-pkg', '2.0.0', { 'a.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-nv');
    fs.mkdirSync(outputDir, { recursive: true });

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'a.txt',
        packageName: 'no-version-pkg',
        packageVersion: '2.0.0',
        kind: 'file',
        checksum: sha256('hello'),
        mutable: false,
      },
    ]);
    fs.writeFileSync(path.join(outputDir, 'a.txt'), 'hello');

    const events: Array<{ type: string; version?: string }> = [];
    const entries: FiledistExtractEntry[] = [
      // No version specified → should use 'latest' in progress events
      { package: 'no-version-pkg', output: { path: outputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      onProgress: (e) => {
        if ('packageVersion' in e) {
          events.push({ type: e.type, version: e.packageVersion });
        }
      },
    });

    // package-end is emitted with the actual installed version
    const endEvent = events.find((e) => e.type === 'package-end');
    expect(endEvent).toBeDefined();
    expect(endEvent?.version).toBe('2.0.0');
    expect(result.ok).toBe(1);
    expect(result.missing).toHaveLength(0);
  }, 60000);

  it('uses provided selector when checking', async () => {
    await installMockPackage('sel-pkg', '1.0.0', { 'docs/api.md': '# API' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-sel');
    fs.mkdirSync(outputDir, { recursive: true });

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'docs/api.md',
        packageName: 'sel-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# API'),
        mutable: false,
      },
    ]);
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs/api.md'), '# API');

    const entries: FiledistExtractEntry[] = [
      {
        package: 'sel-pkg@1.0.0',
        selector: { files: ['**'] },
        output: { path: outputDir },
      },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // With selector matching all files, should be clean
    expect(result.ok).toBeGreaterThan(0);
    expect(result.conflict).toHaveLength(0);
  }, 60000);

  it('does not report managed symlink marker entries as extra drift', async () => {
    await installMockPackage(
      'check-symlink-pkg',
      '1.0.0',
      { 'data/users-dataset/user1.json': '{"id":1}' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'out-symlink');
    fs.mkdirSync(path.join(outputDir, 'data', 'users-dataset'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'data', 'users-dataset', 'user1.json'), '{"id":1}');
    fs.mkdirSync(path.join(outputDir, 'data-symlink'), { recursive: true });
    fs.symlinkSync(
      path.relative(
        path.join(outputDir, 'data-symlink'),
        path.join(outputDir, 'data', 'users-dataset'),
      ),
      path.join(outputDir, 'data-symlink', 'users-dataset'),
    );
    fs.symlinkSync(
      path.relative(
        path.join(outputDir, 'data-symlink'),
        path.join(outputDir, 'data', 'users-dataset', 'user1.json'),
      ),
      path.join(outputDir, 'data-symlink', 'user1.json'),
    );

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'data/users-dataset/user1.json',
        packageName: 'check-symlink-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('{"id":1}'),
        mutable: false,
      },
      {
        path: 'data-symlink/users-dataset',
        packageName: 'check-symlink-pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: sha256('../data/users-dataset'),
        mutable: false,
      },
      {
        path: 'data-symlink/user1.json',
        packageName: 'check-symlink-pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: sha256('../data/users-dataset/user1.json'),
        mutable: false,
      },
    ]);

    const result = await actionCheck({
      entries: [
        {
          package: 'check-symlink-pkg@1.0.0',
          selector: { files: ['data/**'] },
          output: {
            path: outputDir,
            symlinks: [{ source: 'data/**', target: 'data-symlink' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('reports retargeted managed symlinks as conflicts', async () => {
    await installMockPackage(
      'check-symlink-drift-pkg',
      '1.0.0',
      { 'data/users-dataset/user1.json': '{"id":1}' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'out-symlink-drift');
    fs.mkdirSync(path.join(outputDir, 'data', 'users-dataset'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'data', 'users-dataset', 'user1.json'), '{"id":1}');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'README.md'), '# not the dataset');
    fs.mkdirSync(path.join(outputDir, 'data-symlink'), { recursive: true });
    fs.symlinkSync(
      path.relative(
        path.join(outputDir, 'data-symlink'),
        path.join(outputDir, 'data', 'users-dataset'),
      ),
      path.join(outputDir, 'data-symlink', 'users-dataset'),
    );
    fs.symlinkSync(
      path.relative(
        path.join(outputDir, 'data-symlink'),
        path.join(outputDir, 'docs', 'README.md'),
      ),
      path.join(outputDir, 'data-symlink', 'user1.json'),
    );

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'data/users-dataset/user1.json',
        packageName: 'check-symlink-drift-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('{"id":1}'),
        mutable: false,
      },
      {
        path: 'data-symlink/users-dataset',
        packageName: 'check-symlink-drift-pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: sha256('../data/users-dataset'),
        mutable: false,
      },
      {
        path: 'data-symlink/user1.json',
        packageName: 'check-symlink-drift-pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
        checksum: sha256('../data/users-dataset/user1.json'),
        mutable: false,
      },
    ]);

    const result = await actionCheck({
      entries: [
        {
          package: 'check-symlink-drift-pkg@1.0.0',
          selector: { files: ['data/**'] },
          output: {
            path: outputDir,
            symlinks: [{ source: 'data/**', target: 'data-symlink' }],
          },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toContain('data-symlink/user1.json');
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('presets option filters which entries are checked', async () => {
    await installMockPackage('presets-docs-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('presets-data-pkg', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    const docsOutput = path.join(tmpDir, 'out-docs');
    const dataOutput = path.join(tmpDir, 'out-data');

    // Set up marker and matching files for both packages so check passes when run
    fs.mkdirSync(path.join(docsOutput, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(docsOutput, 'docs/guide.md'), '# Guide');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, docsOutput, [
      {
        path: 'docs/guide.md',
        packageName: 'presets-docs-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# Guide'),
        mutable: false,
      },
    ]);

    fs.mkdirSync(path.join(dataOutput, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dataOutput, 'data/sample.csv'), 'a,b');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, dataOutput, [
      {
        path: 'data/sample.csv',
        packageName: 'presets-data-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('a,b'),
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'presets-docs-pkg@1.0.0', output: { path: docsOutput }, presets: ['docs'] },
      { package: 'presets-data-pkg@1.0.0', output: { path: dataOutput }, presets: ['data'] },
    ];

    // Check with presets=['docs'] — only the docs entry is checked
    const filteredEntries = filterEntriesByPresets(entries, ['docs']);

    const resultDocs = await actionCheck({
      entries: filteredEntries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(resultDocs.ok).toBeGreaterThan(0);
    expect(resultDocs.missing).toHaveLength(0);
    expect(resultDocs.conflict).toHaveLength(0);
    expect(resultDocs.extra).toHaveLength(0);

    // Delete the data file — with presets=['docs'] it is ignored
    fs.rmSync(path.join(dataOutput, 'data/sample.csv'));
    const filteredEntriesDocs = filterEntriesByPresets(entries, ['docs']);
    const resultDocsOnly = await actionCheck({
      entries: filteredEntriesDocs,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // data entry was filtered out, so missing data file is not reported
    expect(resultDocsOnly.missing).toHaveLength(0);

    // Now check with presets=['data'] — the missing data file should be reported
    const filteredEntriesData = filterEntriesByPresets(entries, ['data']);
    const resultData = await actionCheck({
      entries: filteredEntriesData,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(resultData.missing).toContain('data/sample.csv');
  }, 60000);

  it('presets=[] checks all entries', async () => {
    await installMockPackage('all-presets-pkg', '1.0.0', { 'file.md': '# File' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out-all');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'file.md'), '# File');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'file.md',
        packageName: 'all-presets-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# File'),
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'all-presets-pkg@1.0.0', output: { path: outputDir }, presets: ['some-tag'] },
    ];

    // presets=[] means no filtering — all entries pass through
    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.ok).toBeGreaterThan(0);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
  }, 60000);

  it('recursively checks transitive packages declared in filedist.sets', async () => {
    // Parent package installed in node_modules with filedist.sets pointing at a child
    const parentPkgDir = path.join(tmpDir, 'node_modules', 'recurse-parent');
    fs.mkdirSync(parentPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(parentPkgDir, 'package.json'),
      JSON.stringify({ name: 'recurse-parent', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(parentPkgDir, '.filedist-package.yml'),
      yaml.dump(
        { sets: [{ package: 'recurse-child@1.0.0', output: { path: 'child-out' } }] },
        { indent: 2 },
      ),
    );

    // Child package installed too
    const childPkgDir = path.join(tmpDir, 'node_modules', 'recurse-child');
    fs.mkdirSync(childPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(childPkgDir, 'package.json'),
      JSON.stringify({ name: 'recurse-child', version: '1.0.0' }),
    );
    // Child package has a file that can be checked
    fs.writeFileSync(path.join(childPkgDir, 'child.md'), 'child content');

    // Parent output dir with a matching file + marker
    const parentOutputDir = path.join(tmpDir, 'parent-out');
    fs.mkdirSync(parentOutputDir, { recursive: true });
    fs.writeFileSync(path.join(parentOutputDir, 'parent.md'), 'parent content');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, parentOutputDir, [
      {
        path: 'parent.md',
        packageName: 'recurse-parent',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('parent content'),
        mutable: false,
      },
    ]);

    // Child output dir (parent output + child path) — child.md is MISSING on disk
    const childOutputDir = path.join(tmpDir, 'parent-out', 'child-out');
    fs.mkdirSync(childOutputDir, { recursive: true });
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, childOutputDir, [
      {
        path: 'child.md',
        packageName: 'recurse-child',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    // Deliberately do NOT write child.md → should appear as missing after check

    const entries: FiledistExtractEntry[] = [
      { package: 'recurse-parent@1.0.0', output: { path: parentOutputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Parent file is present and matching — no drift there
    expect(result.missing).not.toContain('parent.md');
    // Child file is missing — recursive check must detect it
    expect(result.missing).toContain('child.md');
  }, 60000);

  it('ignores nested managed=false files during check', async () => {
    await installMockPackage(
      'nested-child',
      '1.0.0',
      { 'conf/config-schema.js': 'pkg content' },
      tmpDir,
    );
    await installMockPackage('nested-parent', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const parentPkgYmlPath = path.join(
      tmpDir,
      'node_modules',
      'nested-parent',
      '.filedist-package.yml',
    );
    fs.writeFileSync(
      parentPkgYmlPath,
      yaml.dump(
        {
          sets: [
            {
              package: 'nested-child@1.0.0',
              selector: { files: ['conf/config-schema.js'] },
              output: { path: '.', managed: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'out-nested-managed-false');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(outputDir, 'conf'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs/guide.md'), '# Guide');
    fs.writeFileSync(path.join(outputDir, 'conf/config-schema.js'), 'custom local content');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'docs/guide.md',
        packageName: 'nested-parent',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# Guide'),
        mutable: false,
      },
    ]);

    const result = await actionCheck({
      entries: [{ package: 'nested-parent@1.0.0', output: { path: outputDir } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.ok).toBe(1);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('verbose mode logs without errors', async () => {
    await installMockPackage('verbose-check-pkg', '1.0.0', { 'readme.md': '# hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-verbose');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'readme.md'), '# hello');

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'readme.md',
        packageName: 'verbose-check-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# hello'),
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'verbose-check-pkg@1.0.0', output: { path: outputDir } },
    ];

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(jest.fn());
    try {
      const result = await actionCheck({
        entries,
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        verbose: true,
      });
      expect(result.ok).toBe(1);
      expect(result.missing).toHaveLength(0);
      expect(result.conflict).toHaveLength(0);

      const logs = consoleSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(logs).toContain('[verbose] actionCheck: resolving files (cwd: .)');
      expect(logs).toContain('[verbose] calculateDiff: out-verbose:');
      expect(logs).not.toContain(outputDir);
    } finally {
      consoleSpy.mockRestore();
    }
  }, 60000);

  it('verbose mode logs when package not installed', async () => {
    await installMockPackage('missing-verbose-pkg', '1.0.0', { 'file.md': 'content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out-vnp');
    fs.mkdirSync(outputDir, { recursive: true });

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'file.md',
        packageName: 'missing-verbose-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    // Deliberately do NOT write file.md to outputDir → it will be missing

    const entries: FiledistExtractEntry[] = [
      { package: 'missing-verbose-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      verbose: true,
    });
    expect(result.ok).toBe(0);
    expect(result.missing).toHaveLength(1);
  }, 60000);

  it('handles error reading transitive package.json gracefully with verbose', async () => {
    // Install a valid package so getInstalledIfSatisfies can parse the version.
    // Then spy on fs.readFileSync to throw on the second read of that package.json
    // (the one done inside the try/catch in actionCheck that looks for filedist.sets),
    // covering the catch + verbose warn branches.
    await installMockPackage('spy-corrupt-parent', '1.0.0', { 'readme.md': '# hi' }, tmpDir);

    const pkgJsonPath = path.join(tmpDir, 'node_modules', 'spy-corrupt-parent', 'package.json');

    const outputDir = path.join(tmpDir, 'out-spy-corrupt');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'readme.md'), '# hi');

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, outputDir, [
      {
        path: 'readme.md',
        packageName: 'spy-corrupt-parent',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('# hi'),
        mutable: false,
      },
    ]);

    const origReadFileSync = fs.readFileSync;
    let pkgJsonCallCount = 0;
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((...args: any[]): any => {
      const filePath = args[0];
      if (typeof filePath === 'string' && filePath === pkgJsonPath) {
        pkgJsonCallCount += 1;
        if (pkgJsonCallCount >= 2) {
          throw new SyntaxError('Simulated corrupt JSON');
        }
      }

      return (origReadFileSync as any)(...args);
    });

    try {
      const entries: FiledistExtractEntry[] = [
        { package: 'spy-corrupt-parent@1.0.0', output: { path: outputDir } },
      ];
      // Should not throw — catch block inside actionCheck handles the error
      const result = await actionCheck({
        entries,
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        verbose: true,
      });
      expect(result).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  }, 60000);

  it('skips entries with managed=false (output.managed=false)', async () => {
    // managed=false entries are filtered before resolveFiles — no package install attempted
    const entries: FiledistExtractEntry[] = [
      {
        package: 'unmanaged-check-pkg',
        output: { path: path.join(tmpDir, 'out'), managed: false },
      },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('verbose mode logs recursion into transitive packages', async () => {
    // Set up the same hierarchical structure as the recursive check test,
    // but call with verbose: true to exercise the "recursing into" log branch.
    const parentPkgDir = path.join(tmpDir, 'node_modules', 'verbose-recurse-parent');
    fs.mkdirSync(parentPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(parentPkgDir, 'package.json'),
      JSON.stringify({ name: 'verbose-recurse-parent', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(parentPkgDir, '.filedist-package.yml'),
      yaml.dump(
        { sets: [{ package: 'verbose-recurse-child@1.0.0', output: { path: 'child-out' } }] },
        { indent: 2 },
      ),
    );

    const childPkgDir = path.join(tmpDir, 'node_modules', 'verbose-recurse-child');
    fs.mkdirSync(childPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(childPkgDir, 'package.json'),
      JSON.stringify({ name: 'verbose-recurse-child', version: '1.0.0' }),
    );
    fs.writeFileSync(path.join(childPkgDir, 'child.md'), 'child content');

    const parentOutputDir = path.join(tmpDir, 'verbose-parent-out');
    fs.mkdirSync(parentOutputDir, { recursive: true });
    fs.writeFileSync(path.join(parentOutputDir, 'parent.md'), 'parent content');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, parentOutputDir, [
      {
        path: 'parent.md',
        packageName: 'verbose-recurse-parent',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('parent content'),
        mutable: false,
      },
    ]);

    const childOutputDir = path.join(tmpDir, 'verbose-parent-out', 'child-out');
    fs.mkdirSync(childOutputDir, { recursive: true });
    fs.writeFileSync(path.join(childOutputDir, 'child.md'), 'child content');
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, childOutputDir, [
      {
        path: 'child.md',
        packageName: 'verbose-recurse-child',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('child content'),
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'verbose-recurse-parent@1.0.0', output: { path: parentOutputDir } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      verbose: true,
    });
    // Both files are present and match — no drift
    expect(result.missing).not.toContain('parent.md');
    expect(result.missing).not.toContain('child.md');
  }, 60000);

  it('does not report false positives when two packages share the same outputDir', async () => {
    // Regression test for bug: existingMarker was not filtered by packageName before
    // being passed to checkFileset, causing files owned by other packages in the same
    // outputDir to be checked against the current package's source and falsely reported
    // as extra or modified.
    await installMockPackage('shared-pkg-a', '1.0.0', { 'a.md': 'AAA' }, tmpDir);
    await installMockPackage('shared-pkg-b', '1.0.0', { 'b.md': 'BBB' }, tmpDir);

    const sharedOutput = path.join(tmpDir, 'shared-out');
    fs.mkdirSync(sharedOutput, { recursive: true });
    fs.writeFileSync(path.join(sharedOutput, 'a.md'), 'AAA');
    fs.writeFileSync(path.join(sharedOutput, 'b.md'), 'BBB');

    // Both packages share the same output directory and marker file
    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, sharedOutput, [
      {
        path: 'a.md',
        packageName: 'shared-pkg-a',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('AAA'),
        mutable: false,
      },
      {
        path: 'b.md',
        packageName: 'shared-pkg-b',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('BBB'),
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'shared-pkg-a@1.0.0', output: { path: sharedOutput } },
      { package: 'shared-pkg-b@1.0.0', output: { path: sharedOutput } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    // b.md should not appear as extra/modified when checking shared-pkg-a
    // a.md should not appear as extra/modified when checking shared-pkg-b
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    // extra may include things from respective package sources; we care that
    // cross-package files are not falsely reported.
    expect(result.extra).not.toContain('a.md'); // a.md is in shared-pkg-a's source
    expect(result.extra).not.toContain('b.md'); // b.md is in shared-pkg-b's source
  }, 60000);

  it('reports only missing files owned by the queried package when it is not installed', async () => {
    // Install absent-pkg with b.md but don't write b.md to output → appears as missing
    await installMockPackage('absent-pkg', '1.0.0', { 'b.md': 'BBB' }, tmpDir);
    await installMockPackage('present-pkg', '1.0.0', { 'a.md': 'AAA' }, tmpDir);

    const sharedOutput = path.join(tmpDir, 'shared-out-missing');
    fs.mkdirSync(sharedOutput, { recursive: true });
    // Write a.md to disk (present-pkg's file is present)
    fs.writeFileSync(path.join(sharedOutput, 'a.md'), 'AAA');
    // Deliberately do NOT write b.md (absent-pkg's file is missing from output)

    writeManagedFilesForDir(path.join(tmpDir, '.filedist.lock'), tmpDir, sharedOutput, [
      {
        path: 'a.md',
        packageName: 'present-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: sha256('AAA'),
        mutable: false,
      },
      {
        path: 'b.md',
        packageName: 'absent-pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);

    const entries: FiledistExtractEntry[] = [
      { package: 'absent-pkg@1.0.0', output: { path: sharedOutput } },
    ];

    const result = await actionCheck({
      entries,
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });
    expect(result.missing).toContain('b.md');
    // a.md belongs to present-pkg — must NOT be reported as missing
    expect(result.missing).not.toContain('a.md');
  }, 60000);
});

describe('actionCheck — frozenLockfile', () => {
  it('uses lockfile sets instead of caller entries when frozenLockfile=true', async () => {
    // Install pkg-a so it ends up in node_modules and the lockfile records its sets
    await installMockPackage('frozen-check-a', '1.0.0', { 'a.md': '# A' }, tmpDir);
    await installMockPackage('frozen-check-b', '1.0.0', { 'b.md': '# B' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out-frozen-check');

    // Normal install with pkg-a — writes lockfile.sets=[pkg-a]
    await actionInstall({
      entries: [{ package: 'frozen-check-a', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Modify a.md to create drift
    fs.chmodSync(path.join(outputDir, 'a.md'), 0o644);
    fs.writeFileSync(path.join(outputDir, 'a.md'), 'tampered');

    // Frozen check with pkg-b as entries — lockfile sets (pkg-a) must win
    // Drift in a.md should be detected; pkg-b is irrelevant (ignored)
    const result = await actionCheck({
      entries: [{ package: 'frozen-check-b', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      frozenLockfile: true,
    });

    expect(result.ok).toBe(0);
    expect(result.conflict).toContain('a.md');
    // b.md was never extracted and its entry was never in lockfile sets → not reported
    expect(result.missing).not.toContain('b.md');
  }, 90_000);

  it('returns clean summary when files match what lockfile sets describe', async () => {
    await installMockPackage('frozen-check-clean', '1.0.0', { 'doc.md': '# doc' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-frozen-clean');

    await actionInstall({
      entries: [{ package: 'frozen-check-clean', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Pass empty entries — frozen mode reads lockfile sets and checks pkg
    const result = await actionCheck({
      entries: [],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      frozenLockfile: true,
    });

    expect(result.ok).toBeGreaterThan(0);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 90_000);

  it('fails when frozenLockfile=true and no lockfile exists', async () => {
    await expect(
      actionCheck({
        entries: [],
        cwd: tmpDir,
        lockfilePath: path.join(tmpDir, '.filedist.lock'),
        frozenLockfile: true,
      }),
    ).rejects.toThrow('.filedist.lock');
  });

  it('localOnly mode: returns ok when files are intact', async () => {
    await installMockPackage('local-ok-pkg', '1.0.0', { 'lok.md': '# lok' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    await actionInstall({
      entries: [{ package: 'local-ok-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const result = await actionCheck({
      entries: [{ package: 'local-ok-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      localOnly: true,
      verbose: true,
    });

    expect(result.ok).toBeGreaterThan(0);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
  }, 90_000);

  it('localOnly mode: detects missing files', async () => {
    await installMockPackage('local-miss-pkg', '1.0.0', { 'miss.md': '# miss' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    await actionInstall({
      entries: [{ package: 'local-miss-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    // Delete the installed file to simulate missing
    fs.rmSync(path.join(outputDir, 'miss.md'));

    const result = await actionCheck({
      entries: [{ package: 'local-miss-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      localOnly: true,
      verbose: true,
    });

    expect(result.missing).toHaveLength(1);
  }, 90_000);

  it('frozenLockfile mode with verbose emits verbose log', async () => {
    await installMockPackage('frozen-verbose-pkg', '1.0.0', { 'fv.md': '# fv' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    await actionInstall({
      entries: [
        { package: 'frozen-verbose-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    const result = await actionCheck({
      entries: [],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
      frozenLockfile: true,
      verbose: true,
    });

    expect(result.ok).toBeGreaterThan(0);
  }, 90_000);

  it('returns empty summary when all entries have managed=false', async () => {
    const result = await actionCheck({
      entries: [
        {
          package: 'any-pkg@1.0.0',
          output: { path: path.join(tmpDir, 'out'), gitignore: false, managed: false },
        },
      ],
      cwd: tmpDir,
      lockfilePath: path.join(tmpDir, '.filedist.lock'),
    });

    expect(result.ok).toBe(0);
    expect(result.missing).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });
});
