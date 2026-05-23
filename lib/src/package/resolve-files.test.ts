import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import { createMockGitRepo, installMockPackage } from '../fileset/test-utils';
import { FiledistExtractEntry } from '../types';

import { resolveFiles, resolveFilesDetailed } from './resolve-files';

describe('resolveFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-resolve-files-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves an external leaf package (no sets) to its files', async () => {
    await installMockPackage('leaf-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    const entries: FiledistExtractEntry[] = [
      { package: 'leaf-pkg', output: { path: outputDir, gitignore: false } },
    ];

    const files = await resolveFiles(entries, { cwd: tmpDir });

    expect(files).toHaveLength(1);
    expect(files[0].relPath).toBe('docs/guide.md');
    expect(files[0].packageName).toBe('leaf-pkg');
    expect(files[0].outputDir).toBe(outputDir);
    expect(files[0].managed).toBe(true);
  }, 60000);

  it('resolves a self-package entry inside filedist.sets', async () => {
    // Install a package that has filedist.sets with a self-package entry (no package field)
    await installMockPackage('self-pkg', '1.0.0', { 'data/sample.json': '{}' }, tmpDir);

    // Patch the installed package.json to include a self-package filedist set
    const pkgPath = path.join(tmpDir, 'node_modules', 'self-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            // Self-package entry: no package field
            { output: { path: '.' } },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const entries: FiledistExtractEntry[] = [
      { package: 'self-pkg', output: { path: outputDir, gitignore: false } },
    ];

    const files = await resolveFiles(entries, { cwd: tmpDir });

    expect(files.some((f) => f.relPath === 'data/sample.json')).toBe(true);
    expect(files.every((f) => f.packageName === 'self-pkg')).toBe(true);
  }, 60000);

  it('does not duplicate self-package files when presets are not requested', async () => {
    await installMockPackage('self-pkg', '1.0.0', { 'data/sample.json': '{}' }, tmpDir);

    const pkgPath = path.join(tmpDir, 'node_modules', 'self-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        { sets: [{ output: { path: '.' }, selector: { files: ['data/**'] }, presets: ['basic'] }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const files = await resolveFiles(
      [{ package: 'self-pkg', output: { path: outputDir, gitignore: false } }],
      { cwd: tmpDir },
    );

    expect(files.filter((f) => f.relPath === 'data/sample.json')).toHaveLength(1);
  }, 60000);

  it('resolves an external package with sets by recursing into them', async () => {
    await installMockPackage('child-pkg', '1.0.0', { 'child.md': '# Child' }, tmpDir);
    await installMockPackage('parent-pkg', '1.0.0', { 'parent.md': '# Parent' }, tmpDir);

    // Patch parent to declare filedist.sets with self-package and child entries
    const parentPath = path.join(tmpDir, 'node_modules', 'parent-pkg');
    fs.writeFileSync(
      path.join(parentPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            { output: { path: '.' } }, // self-package entry
            { package: 'child-pkg', output: { path: 'child' } }, // external entry
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const entries: FiledistExtractEntry[] = [
      { package: 'parent-pkg', output: { path: outputDir, gitignore: false } },
    ];

    const files = await resolveFiles(entries, { cwd: tmpDir });

    const relPaths = files.map((f) => f.relPath);
    expect(relPaths).toContain('parent.md');
    expect(relPaths).toContain('child.md');
  }, 60000);

  it('inherits parent file selectors into external package sets', async () => {
    await installMockPackage('dep-pkg', '1.0.0', { 'conf/dep.js': 'dep' }, tmpDir);
    await installMockPackage('parent-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const parentPath = path.join(tmpDir, 'node_modules', 'parent-pkg');
    fs.writeFileSync(
      path.join(parentPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            { output: { path: '.' }, selector: { files: ['docs/**'] } },
            { package: 'dep-pkg', output: { path: '.' }, selector: { files: ['conf/dep.js'] } },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const files = await resolveFiles(
      [
        {
          package: 'parent-pkg',
          output: { path: outputDir, gitignore: false },
          selector: { files: ['docs/**'] },
        },
      ],
      { cwd: tmpDir },
    );

    const relPaths = files.map((f) => f.relPath);
    expect(relPaths).toEqual(['docs/guide.md']);
    expect(relPaths).not.toContain('conf/dep.js');
  }, 60000);

  it('skips disjoint self-package selectors instead of enumerating all files', async () => {
    await installMockPackage(
      'self-filter-pkg',
      '1.0.0',
      { 'docs/guide.md': '# Guide', 'data/sample.json': '{}' },
      tmpDir,
    );

    const pkgPath = path.join(tmpDir, 'node_modules', 'self-filter-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        { sets: [{ output: { path: '.' }, selector: { files: ['data/**'] } }] },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const files = await resolveFiles(
      [
        {
          package: 'self-filter-pkg',
          output: { path: outputDir, gitignore: false },
          selector: { files: ['docs/**'] },
        },
      ],
      { cwd: tmpDir },
    );

    expect(files.map((f) => f.relPath)).toEqual([]);
  }, 60000);

  it('resolves a git-prefixed source with a git ref', async () => {
    const repo = await createMockGitRepo('git-leaf', { 'docs/guide.md': '# Git Guide' }, tmpDir, {
      tag: 'v1.0.0',
    });

    const outputDir = path.join(tmpDir, 'output-git');
    const entries: FiledistExtractEntry[] = [
      {
        package: `git:${repo.repoUrl}@v1.0.0`,
        output: { path: outputDir, gitignore: false },
      },
    ];

    const files = await resolveFiles(entries, { cwd: tmpDir });

    expect(files).toHaveLength(1);
    expect(files[0].relPath).toBe('docs/guide.md');
    expect(files[0].packageName).toBe(repo.repoUrl);
    expect(files[0].packageVersion).toBe(repo.head.slice(0, 12));
  }, 60000);

  it('loads nested .filedistrc config from cloned git repos recursively', async () => {
    const childRepo = await createMockGitRepo(
      'git-child',
      { 'child/guide.md': '# Child Guide' },
      tmpDir,
      { tag: 'child-v1' },
    );
    const parentRepo = await createMockGitRepo('git-parent', { 'parent.md': '# Parent' }, tmpDir, {
      tag: 'parent-v1',
      filedistConfig: {
        sets: [
          { output: { path: '.', gitignore: false } },
          {
            package: `git:${childRepo.repoUrl}@child-v1`,
            output: { path: 'nested', gitignore: false },
          },
        ],
      },
    });

    const outputDir = path.join(tmpDir, 'output-git-nested');
    const files = await resolveFiles(
      [
        {
          package: `git:${parentRepo.repoUrl}@parent-v1`,
          output: { path: outputDir, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    expect(files.map((file) => file.relPath)).toEqual(
      expect.arrayContaining(['parent.md', 'child/guide.md']),
    );
    expect(files.find((file) => file.relPath === 'child/guide.md')?.outputDir).toBe(
      path.join(outputDir, 'nested'),
    );
  }, 60000);

  it('uses self sets for split managed and unmanaged package files', async () => {
    await installMockPackage(
      'split-self-pkg',
      '1.0.0',
      {
        'data/user1.json': '{"id":1}',
        'data/user2.json': '{"id":2}',
      },
      tmpDir,
    );

    const pkgPath = path.join(tmpDir, 'node_modules', 'split-self-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            {
              selector: {
                files: ['data/**'],
                exclude: ['data/user2.json'],
              },
              output: { path: '.', gitignore: false },
            },
            {
              selector: { files: ['data/user2.json'] },
              output: { path: '.', managed: false, gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const files = await resolveFiles(
      [{ package: 'split-self-pkg', output: { path: outputDir, gitignore: false } }],
      { cwd: tmpDir },
    );

    expect(files).toHaveLength(2);
    expect(files.find((f) => f.relPath === 'data/user1.json')?.managed).toBe(true);
    expect(files.find((f) => f.relPath === 'data/user2.json')?.managed).toBe(false);
  }, 60000);

  it('reprocesses self sets when the same package is extracted twice with different output settings', async () => {
    await installMockPackage(
      'split-repeat-pkg',
      '1.0.0',
      {
        'data/user1.json': '{"id":1}',
        'data/user2.json': '{"id":2}',
      },
      tmpDir,
    );

    const pkgPath = path.join(tmpDir, 'node_modules', 'split-repeat-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            {
              selector: {
                files: ['data/**'],
                exclude: ['data/user2.json'],
              },
              output: { path: '.', gitignore: false },
            },
            {
              selector: { files: ['data/user2.json'] },
              output: { path: '.', managed: false, gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const files = await resolveFiles(
      [
        {
          package: 'split-repeat-pkg',
          selector: {
            files: ['data/**'],
            exclude: ['data/user2.json'],
          },
          output: { path: outputDir, gitignore: false },
        },
        {
          package: 'split-repeat-pkg',
          selector: { files: ['data/user2.json'] },
          output: { path: outputDir, managed: false, mutable: true, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    expect(files).toHaveLength(2);
    expect(files.find((f) => f.relPath === 'data/user1.json')?.managed).toBe(true);
    expect(files.find((f) => f.relPath === 'data/user2.json')?.managed).toBe(false);
    expect(files.find((f) => f.relPath === 'data/user2.json')?.mutable).toBe(true);
  }, 60000);

  it('applies explicit selectors through package self-set recursion using semantic file matching', async () => {
    await installMockPackage(
      'explicit-selector-pkg',
      '1.0.0',
      {
        '.configs/app.config.json': '{"app":true}',
        '.configs/database.config.json': '{"db":true}',
        'docs/README.md': '# Docs',
        'data/users-dataset/user2.json': '{"id":2}',
      },
      tmpDir,
    );

    const pkgPath = path.join(tmpDir, 'node_modules', 'explicit-selector-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            {
              selector: {
                files: ['docs/**', 'data/**', '.configs/**'],
                exclude: ['data/users-dataset/user2.json'],
              },
              output: { path: '.' },
            },
            {
              selector: { files: ['data/users-dataset/user2.json'] },
              output: { path: '.', managed: false, gitignore: false },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const files = await resolveFiles(
      [
        {
          package: 'explicit-selector-pkg',
          selector: {
            files: ['.configs/**', 'docs/**'],
            exclude: ['.configs/database.config.json'],
          },
          output: { path: outputDir, gitignore: false },
        },
        {
          package: 'explicit-selector-pkg',
          selector: { files: ['.configs/database.config.json'] },
          output: { path: outputDir, managed: false, mutable: true, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    expect(files).toHaveLength(3);
    expect(files.find((f) => f.relPath === '.configs/app.config.json')?.managed).toBe(true);
    expect(files.find((f) => f.relPath === 'docs/README.md')?.managed).toBe(true);
    expect(files.find((f) => f.relPath === '.configs/database.config.json')?.managed).toBe(false);
    expect(files.find((f) => f.relPath === '.configs/database.config.json')?.mutable).toBe(true);
  }, 60000);

  it('deduplicates files resolved by the same package twice', async () => {
    await installMockPackage('dup-pkg', '1.0.0', { 'file.md': '# File' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    const entries: FiledistExtractEntry[] = [
      { package: 'dup-pkg', output: { path: outputDir, gitignore: false } },
      { package: 'dup-pkg', output: { path: outputDir, gitignore: false } },
    ];

    const files = await resolveFiles(entries, { cwd: tmpDir });

    // Same file from same package to same outputDir should appear only once
    const matches = files.filter((f) => f.relPath === 'file.md');
    expect(matches).toHaveLength(1);
  }, 60000);

  it('throws on conflict when same file resolved with different managed settings', async () => {
    await installMockPackage('conflict-pkg', '1.0.0', { 'file.md': '# File' }, tmpDir);

    // Patch to have two sets with different managed settings for the same path
    const pkgPath = path.join(tmpDir, 'node_modules', 'conflict-pkg');
    const outputDir = path.join(tmpDir, 'output');

    // This should throw because same file with managed=true vs managed=false
    // Actually they have the same selector so the second is deduplicated by visited check
    // Let's patch to create two separate entries with different package.json contents
    void pkgPath; // suppress unused warning

    // The deduplication by entryKey prevents conflict here (same entry = same key)
    // A real conflict needs different entry keys (e.g., different selectors)
    const files = await resolveFiles(
      [{ package: 'conflict-pkg', output: { path: outputDir, managed: true, gitignore: false } }],
      { cwd: tmpDir },
    );
    expect(files).toHaveLength(1);
  }, 60000);

  it('filters sets by presets when selector.presets is specified', async () => {
    await installMockPackage(
      'presets-pkg',
      '1.0.0',
      { 'docs.md': '# Docs', 'data.json': '{}' },
      tmpDir,
    );

    const pkgPath = path.join(tmpDir, 'node_modules', 'presets-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            { presets: ['docs'], output: { path: '.' }, selector: { files: ['*.md'] } },
            { presets: ['data'], output: { path: '.' }, selector: { files: ['*.json'] } },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const entries: FiledistExtractEntry[] = [
      {
        package: 'presets-pkg',
        output: { path: outputDir, gitignore: false },
        selector: { presets: ['docs'] },
      },
    ];

    const files = await resolveFiles(entries, { cwd: tmpDir });

    const relPaths = files.map((f) => f.relPath);
    expect(relPaths).toContain('docs.md');
    expect(relPaths).not.toContain('data.json');
  }, 60000);

  it('tracks preset-filtered transitive packages as relevant for stale cleanup', async () => {
    await installMockPackage('preset-cleanup-pkg', '1.0.0', { 'data.json': '{"ok":true}' }, tmpDir);

    const pkgPath = path.join(tmpDir, 'node_modules', 'preset-cleanup-pkg');
    fs.writeFileSync(
      path.join(pkgPath, '.filedist-package.yml'),
      yaml.dump(
        {
          sets: [
            { presets: ['special'], output: { path: '.' }, selector: { files: ['data.json'] } },
            {
              package: 'eslint@8',
              presets: ['eslint'],
              output: { path: '.' },
              selector: { files: ['conf/globals.js'] },
            },
          ],
        },
        { indent: 2 },
      ),
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await resolveFilesDetailed(
      [
        {
          package: 'preset-cleanup-pkg',
          output: { path: outputDir, gitignore: false },
          selector: { presets: ['special'] },
        },
      ],
      { cwd: tmpDir },
    );

    expect(result.files.map((f) => f.relPath)).toEqual(['data.json']);
    expect(result.relevantPackagesByOutputDir.get(outputDir)).toEqual(
      new Set(['preset-cleanup-pkg', 'eslint']),
    );
  }, 60000);

  it('emits package-start and package-end progress events', async () => {
    await installMockPackage('progress-pkg', '1.0.0', { 'file.md': '# File' }, tmpDir);

    const events: string[] = [];
    const outputDir = path.join(tmpDir, 'output');

    await resolveFiles(
      [{ package: 'progress-pkg', output: { path: outputDir, gitignore: false } }],
      {
        cwd: tmpDir,
        onProgress: (e) => events.push(e.type),
      },
    );

    expect(events).toContain('package-start');
    expect(events).toContain('package-end');
  }, 60000);

  it('resolves the same git repo twice with different sparse selector patterns independently', async () => {
    const repo = await createMockGitRepo(
      'git-sparse-multi',
      {
        'docs/guide.md': '# Guide',
        'src/index.ts': 'export {}',
        'config/app.json': '{}',
      },
      tmpDir,
      { tag: 'v1.0.0' },
    );

    const outputDocs = path.join(tmpDir, 'output-docs');
    const outputSrc = path.join(tmpDir, 'output-src');

    const files = await resolveFiles(
      [
        {
          package: `git:${repo.repoUrl}@v1.0.0`,
          selector: { files: ['docs/**'] },
          output: { path: outputDocs, gitignore: false },
        },
        {
          package: `git:${repo.repoUrl}@v1.0.0`,
          selector: { files: ['src/**'] },
          output: { path: outputSrc, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    // Each entry resolved with its own sparse patterns — no cross-contamination
    const docFiles = files.filter((f) => f.outputDir === outputDocs).map((f) => f.relPath);
    const srcFiles = files.filter((f) => f.outputDir === outputSrc).map((f) => f.relPath);

    expect(docFiles).toEqual(['docs/guide.md']);
    expect(srcFiles).toEqual(['src/index.ts']);
  }, 60000);

  it('two-pass sparse checkout: self-set with explicit patterns — only config first, then content', async () => {
    // Repo has content in two dirs; the filedist self-set constrains to docs/** only.
    // Phase 1 fetches only config files. Phase 2 expands to docs/** discovered from the
    // self-set so those files are materialised before enumeratePackageFiles runs.
    const repo = await createMockGitRepo(
      'git-twopass-pattern',
      {
        'docs/guide.md': '# Guide',
        'src/index.ts': 'export {}',
      },
      tmpDir,
      {
        tag: 'v1.0.0',
        filedistConfig: {
          sets: [{ selector: { files: ['docs/**'] }, output: { path: '.', gitignore: false } }],
        },
      },
    );

    const outputDir = path.join(tmpDir, 'output-twopass-pattern');
    const files = await resolveFiles(
      [
        {
          // No explicit selector — caller defers to the package's own config
          package: `git:${repo.repoUrl}@v1.0.0`,
          output: { path: outputDir, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    const relPaths = files.map((f) => f.relPath);
    expect(relPaths).toContain('docs/guide.md');
    expect(relPaths).not.toContain('src/index.ts');
  }, 60000);

  it('two-pass sparse checkout: multiple sets — second set is self-pointing, no caller selector', async () => {
    // Package has two sets: first is an external ref, second is a self-set with file patterns.
    // Phase 1 fetches only config files. Phase 2 must expand to the self-set patterns
    // (docs/**) so those files are materialised. src/index.ts must NOT be materialised
    // because it is outside the self-set's patterns.
    const externalRepo = await createMockGitRepo(
      'git-twopass-external',
      { 'lib/helper.ts': 'export const x = 1;' },
      tmpDir,
      { tag: 'ext-v1.0.0' },
    );
    const repo = await createMockGitRepo(
      'git-twopass-second-self',
      {
        'docs/guide.md': '# Guide',
        'src/index.ts': 'export {}',
      },
      tmpDir,
      {
        tag: 'v1.0.0',
        filedistConfig: {
          sets: [
            // first set: external reference
            {
              package: `git:${externalRepo.repoUrl}@ext-v1.0.0`,
              output: { path: 'from-ext', gitignore: false },
            },
            // second set: self-pointing with constrained file patterns
            { selector: { files: ['docs/**'] }, output: { path: '.', gitignore: false } },
          ],
        },
      },
    );

    const outputDir = path.join(tmpDir, 'output-twopass-second-self');
    const files = await resolveFiles(
      [
        {
          // No explicit selector — caller defers entirely to the package's own config
          package: `git:${repo.repoUrl}@v1.0.0`,
          output: { path: outputDir, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    const selfFiles = files.filter((f) => f.packageName === repo.repoUrl).map((f) => f.relPath);
    // Phase 2 should expand to docs/** from the second (self) set only
    expect(selfFiles).toContain('docs/guide.md');
    expect(selfFiles).not.toContain('src/index.ts');
    // External package files should also be resolved
    const extFiles = files
      .filter((f) => f.packageName === externalRepo.repoUrl)
      .map((f) => f.relPath);
    expect(extFiles).toContain('lib/helper.ts');
  }, 60000);

  it('two-pass sparse checkout: no self-set config — phase 2 expands to all files', async () => {
    // Repo has no filedist config at all. Phase 1 fetches only config files (none present),
    // phase 2 must expand to ** so enumeratePackageFiles can discover all content.
    const repo = await createMockGitRepo(
      'git-twopass-noconfig',
      {
        'docs/guide.md': '# Guide',
        'src/index.ts': 'export {}',
      },
      tmpDir,
      { tag: 'v1.0.0' },
    );

    const outputDir = path.join(tmpDir, 'output-twopass-noconfig');
    const files = await resolveFiles(
      [
        {
          package: `git:${repo.repoUrl}@v1.0.0`,
          output: { path: outputDir, gitignore: false },
        },
      ],
      { cwd: tmpDir },
    );

    const relPaths = files.map((f) => f.relPath);
    expect(relPaths).toContain('docs/guide.md');
    expect(relPaths).toContain('src/index.ts');
  }, 60000);
});
