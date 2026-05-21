import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import yaml from 'js-yaml';

import { installMockPackage } from '../fileset/test-utils';
import { ProgressEvent } from '../types';

import { actionInstall } from './action-install';
import { actionRemove } from './action-remove';
import { readLockfile, readManagedFilesForDir } from './lockfile';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-action-remove-'));
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

/**
 * Write a .filedistrc.yml config file to tmpDir.
 */
function writeConfig(sets: object[]): string {
  const filePath = path.join(tmpDir, '.filedistrc.yml');
  fs.writeFileSync(filePath, yaml.dump({ sets }, { indent: 2 }), 'utf8');
  return filePath;
}

/**
 * Read the sets array from .filedistrc.yml in tmpDir.
 */
function readConfigSets(): object[] {
  const filePath = path.join(tmpDir, '.filedistrc.yml');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw) as { sets?: object[] } | null;
  return parsed?.sets ?? [];
}

describe('actionRemove — config entry removal', () => {
  it('removes all entries for a package (ignoring version)', async () => {
    await installMockPackage('pkg-a', '1.0.0', { 'file.md': '# a' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'pkg-a@1.0.0', output: { path: outputDir, gitignore: false } }]);

    // Install first
    await actionInstall({
      entries: [{ package: 'pkg-a@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'pkg-a',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    expect(result.removedEntries).toBe(1);
    expect(readConfigSets()).toHaveLength(0);
  }, 60_000);

  it('ignores version/ref in packageSpec when matching', async () => {
    await installMockPackage('versioned-pkg', '2.3.4', { 'doc.txt': 'hi' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([
      { package: 'versioned-pkg@^2.0.0', output: { path: outputDir, gitignore: false } },
    ]);

    await actionInstall({
      entries: [{ package: 'versioned-pkg@2.3.4', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    // Pass "versioned-pkg@2.3.4" — version part should be ignored for matching
    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'versioned-pkg@2.3.4',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    expect(result.removedEntries).toBe(1);
    expect(readConfigSets()).toHaveLength(0);
  }, 60_000);

  it('removes only matching output path when outputPath filter is supplied', async () => {
    await installMockPackage('multi-out', '1.0.0', { 'a.md': '# a', 'b.md': '# b' }, tmpDir);
    const outA = path.join(tmpDir, 'outA');
    const outB = path.join(tmpDir, 'outB');

    writeConfig([
      { package: 'multi-out@1.0.0', output: { path: outA, gitignore: false } },
      { package: 'multi-out@1.0.0', output: { path: outB, gitignore: false } },
    ]);

    await actionInstall({
      entries: [
        { package: 'multi-out@1.0.0', output: { path: outA, gitignore: false } },
        { package: 'multi-out@1.0.0', output: { path: outB, gitignore: false } },
      ],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'multi-out',
      outputPath: outA,
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    expect(result.removedEntries).toBe(1);
    const remaining = readConfigSets() as Array<{ package?: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].package).toBe('multi-out@1.0.0');
  }, 60_000);

  it('throws when package is not found in config', async () => {
    // Config is empty — the package to remove is not present.
    writeConfig([]);

    await expect(
      actionRemove({
        cwd: tmpDir,
        packageSpec: 'nonexistent-pkg',
        configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      }),
    ).rejects.toThrow('No entries found for "nonexistent-pkg"');
  }, 60_000);

  it('throws when config file path is provided but the file does not exist', async () => {
    await expect(
      actionRemove({
        cwd: tmpDir,
        packageSpec: 'any-pkg',
        configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      }),
    ).rejects.toThrow('No entries found for "any-pkg"');
  }, 60_000);

  it('throws when no config file is found via auto-discovery', async () => {
    // tmpDir has no .filedistrc.yml or any other config file — auto-discovery fails
    await expect(
      actionRemove({
        cwd: tmpDir,
        packageSpec: 'any-pkg',
        // no configFilePath — relies on auto-discovery which will find nothing
      }),
    ).rejects.toThrow('No filedist config file found');
  }, 60_000);
});

describe('actionRemove — file deletion via install', () => {
  it('deletes installed files of removed package from output directory', async () => {
    await installMockPackage('rm-pkg', '1.0.0', { 'guide.md': '# guide' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'rm-pkg@1.0.0', output: { path: outputDir, gitignore: false } }]);

    await actionInstall({
      entries: [{ package: 'rm-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'guide.md'))).toBe(true);

    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'rm-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    expect(fs.existsSync(path.join(outputDir, 'guide.md'))).toBe(false);
  }, 60_000);

  it('keeps files of other packages after remove', async () => {
    await installMockPackage('keep-pkg', '1.0.0', { 'keep.md': '# keep' }, tmpDir);
    await installMockPackage('drop-pkg', '1.0.0', { 'drop.md': '# drop' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([
      { package: 'keep-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
      { package: 'drop-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
    ]);

    await actionInstall({
      entries: [
        { package: 'keep-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
        { package: 'drop-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
      ],
      cwd: tmpDir,
    });

    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'drop-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    expect(fs.existsSync(path.join(outputDir, 'keep.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'drop.md'))).toBe(false);
  }, 60_000);

  it('updates lockfile after remove', async () => {
    await installMockPackage('lock-pkg', '1.0.0', { 'x.md': '# x' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'lock-pkg@1.0.0', output: { path: outputDir, gitignore: false } }]);

    await actionInstall({
      entries: [{ package: 'lock-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const lockBefore = readLockfile(tmpDir);
    expect(lockBefore?.sets?.length).toBeGreaterThan(0);

    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'lock-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    const lockAfter = readLockfile(tmpDir);
    expect(lockAfter?.sets?.length ?? 0).toBe(0);
  }, 60_000);

  it('removes only managed files from disk, clears files in lock, and updates config and lock sets', async () => {
    await installMockPackage('full-check-pkg', '1.0.0', { 'managed.md': '# managed' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    const configFilePath = writeConfig([
      { package: 'full-check-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
    ]);

    await actionInstall({
      entries: [{ package: 'full-check-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    // Place an unmanaged file alongside managed ones — it must survive removal
    const unmanagedFile = path.join(outputDir, 'unmanaged.md');
    fs.writeFileSync(unmanagedFile, '# unmanaged');

    expect(fs.existsSync(path.join(outputDir, 'managed.md'))).toBe(true);
    expect(
      readManagedFilesForDir(tmpDir, outputDir).some((e) => e.packageName === 'full-check-pkg'),
    ).toBe(true);

    await actionRemove({ cwd: tmpDir, packageSpec: 'full-check-pkg', configFilePath });

    // 1. Only managed files removed from disk; unmanaged file untouched
    expect(fs.existsSync(path.join(outputDir, 'managed.md'))).toBe(false);
    expect(fs.existsSync(unmanagedFile)).toBe(true);

    // 2. files in lock no longer contains entries for the removed package
    expect(
      readManagedFilesForDir(tmpDir, outputDir).filter((e) => e.packageName === 'full-check-pkg'),
    ).toHaveLength(0);

    // 3. User config set is updated — entry removed from .filedistrc.yml
    expect(readConfigSets()).toHaveLength(0);

    // 4. Lock set is updated — removed package absent from lockfile sets
    const lockAfterRemove = readLockfile(tmpDir);
    const lockSets = lockAfterRemove?.sets ?? [];
    expect(
      lockSets.every(
        (s) =>
          !('package' in s) || !(s as { package: string }).package.startsWith('full-check-pkg'),
      ),
    ).toBe(true);
  }, 60_000);
});

describe('actionRemove — dry-run', () => {
  it('does not modify config file in dry-run mode', async () => {
    await installMockPackage('dry-pkg', '1.0.0', { 'f.md': '# f' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'dry-pkg@1.0.0', output: { path: outputDir, gitignore: false } }]);

    await actionInstall({
      entries: [{ package: 'dry-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'dry-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      dryRun: true,
    });

    expect(result.removedEntries).toBe(1); // counted but not written
    expect(readConfigSets()).toHaveLength(1); // config unchanged
    expect(fs.existsSync(path.join(outputDir, 'f.md'))).toBe(true); // file untouched
  }, 60_000);
});

describe('actionRemove — progress events', () => {
  it('emits file-deleted events for the removed package files', async () => {
    await installMockPackage('evt-pkg', '1.0.0', { 'evt.md': 'content' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'evt-pkg@1.0.0', output: { path: outputDir, gitignore: false } }]);
    await actionInstall({
      entries: [{ package: 'evt-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const events: Array<{ type: string; file?: string }> = [];
    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'evt-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      onProgress: (e) => events.push({ type: e.type, file: 'file' in e ? e.file : void 0 }),
    });

    expect(events.some((e) => e.type === 'file-deleted' && e.file === 'evt.md')).toBe(true);
  }, 60_000);

  it('emits package-start and package-end events for remaining packages', async () => {
    await installMockPackage('stay-pkg', '1.0.0', { 'stay.md': 'stay' }, tmpDir);
    await installMockPackage('go-pkg', '1.0.0', { 'go.md': 'go' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([
      { package: 'stay-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
      { package: 'go-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
    ]);
    await actionInstall({
      entries: [
        { package: 'stay-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
        { package: 'go-pkg@1.0.0', output: { path: outputDir, gitignore: false } },
      ],
      cwd: tmpDir,
    });

    const eventTypes: string[] = [];
    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'go-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      onProgress: (e) => eventTypes.push(e.type),
    });

    // The remaining 'stay-pkg' is re-installed by actionInstall, emitting package events
    expect(eventTypes).toContain('package-start');
    expect(eventTypes).toContain('package-end');
  }, 60_000);

  it('emits managed and gitignore metadata on file-deleted events', async () => {
    await installMockPackage('meta-pkg', '1.0.0', { 'meta.md': 'meta' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'meta-pkg@1.0.0', output: { path: outputDir, gitignore: true } }]);
    await actionInstall({
      entries: [{ package: 'meta-pkg@1.0.0', output: { path: outputDir, gitignore: true } }],
      cwd: tmpDir,
    });

    const events: ProgressEvent[] = [];
    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'meta-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      onProgress: (e) => events.push(e),
    });

    const fileDeleted = events.find((e) => e.type === 'file-deleted');
    expect(fileDeleted).toMatchObject({
      type: 'file-deleted',
      file: 'meta.md',
      managed: true,
    });
  }, 60_000);
});

describe('actionRemove — verbose', () => {
  it('runs without errors in verbose mode', async () => {
    await installMockPackage('verbose-rm', '1.0.0', { 'v.md': 'v' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'verbose-rm@1.0.0', output: { path: outputDir, gitignore: false } }]);
    await actionInstall({
      entries: [{ package: 'verbose-rm@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'verbose-rm',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      verbose: true,
    });

    expect(result.removedEntries).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'v.md'))).toBe(false);
  }, 60_000);

  it('dry-run verbose runs without errors', async () => {
    await installMockPackage('vdry-rm', '1.0.0', { 'vd.md': 'vd' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'vdry-rm@1.0.0', output: { path: outputDir, gitignore: false } }]);
    await actionInstall({
      entries: [{ package: 'vdry-rm@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'vdry-rm',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      verbose: true,
      dryRun: true,
    });

    expect(result.removedEntries).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'vd.md'))).toBe(true); // not deleted in dry-run
  }, 60_000);
});

describe('actionRemove — hierarchical packages', () => {
  it('removes transitive packages declared in filedist.sets', async () => {
    await installMockPackage('rm-child', '1.0.0', { 'child.md': 'child content' }, tmpDir);
    await installMockPackage('rm-parent', '1.0.0', { 'parent.md': 'parent content' }, tmpDir);

    // Patch parent to declare filedist.sets → child
    const parentPkgJsonPath = path.join(tmpDir, 'node_modules', 'rm-parent', 'package.json');
    const parentPkgJson = JSON.parse(fs.readFileSync(parentPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      parentPkgJsonPath,
      JSON.stringify({
        ...parentPkgJson,
        filedist: { sets: [{ package: 'rm-child@1.0.0', output: { path: 'child-out' } }] },
      }),
    );

    const parentOutputDir = path.join(tmpDir, 'parent-out');
    writeConfig([
      { package: 'rm-parent@1.0.0', output: { path: parentOutputDir, gitignore: false } },
    ]);

    // Install both parent and child via actionInstall
    await actionInstall({
      entries: [
        { package: 'rm-parent@1.0.0', output: { path: parentOutputDir, gitignore: false } },
      ],
      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(parentOutputDir, 'parent.md'))).toBe(true);
    const childOutputDir = path.join(parentOutputDir, 'child-out');
    expect(fs.existsSync(path.join(childOutputDir, 'child.md'))).toBe(true);

    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'rm-parent',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    expect(fs.existsSync(path.join(parentOutputDir, 'parent.md'))).toBe(false);
    expect(fs.existsSync(path.join(childOutputDir, 'child.md'))).toBe(false);
  }, 120_000);
});

describe('actionRemove — files cleanup', () => {
  it('removes files tracked in files that belong to the removed package', async () => {
    await installMockPackage('mf-pkg', '1.0.0', { 'mf.md': '# mf', 'extra.md': '# extra' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'mf-pkg@1.0.0', output: { path: outputDir, gitignore: false } }]);

    await actionInstall({
      entries: [{ package: 'mf-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    // Verify files are tracked in files before removal
    const markerBefore = readManagedFilesForDir(tmpDir, outputDir);
    expect(markerBefore.some((e) => e.packageName === 'mf-pkg')).toBe(true);

    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'mf-pkg',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    // Files gone from disk
    expect(fs.existsSync(path.join(outputDir, 'mf.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'extra.md'))).toBe(false);

    // Marker file no longer has entries for the removed package
    const markerAfter = readManagedFilesForDir(tmpDir, outputDir);
    expect(markerAfter.filter((e) => e.packageName === 'mf-pkg')).toHaveLength(0);
  }, 60_000);

  it('removes stale files entries when install is run with remaining sets', async () => {
    await installMockPackage('stale-a', '1.0.0', { 'a.md': 'a' }, tmpDir);
    await installMockPackage('stale-b', '1.0.0', { 'b.md': 'b' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([
      { package: 'stale-a@1.0.0', output: { path: outputDir, gitignore: false } },
      { package: 'stale-b@1.0.0', output: { path: outputDir, gitignore: false } },
    ]);

    await actionInstall({
      entries: [
        { package: 'stale-a@1.0.0', output: { path: outputDir, gitignore: false } },
        { package: 'stale-b@1.0.0', output: { path: outputDir, gitignore: false } },
      ],
      cwd: tmpDir,
    });

    // Both packages managed before removal
    const markerBefore = readManagedFilesForDir(tmpDir, outputDir);
    expect(markerBefore.some((e) => e.packageName === 'stale-a')).toBe(true);
    expect(markerBefore.some((e) => e.packageName === 'stale-b')).toBe(true);

    // Remove stale-a; stale-b should still be tracked
    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'stale-a',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    // stale-a entries are gone from disk and marker
    expect(fs.existsSync(path.join(outputDir, 'a.md'))).toBe(false);
    const markerAfter = readManagedFilesForDir(tmpDir, outputDir);
    expect(markerAfter.filter((e) => e.packageName === 'stale-a')).toHaveLength(0);

    // stale-b entries still present on disk and in marker
    expect(fs.existsSync(path.join(outputDir, 'b.md'))).toBe(true);
    expect(markerAfter.some((e) => e.packageName === 'stale-b')).toBe(true);
  }, 60_000);

  it('lockfile files does not reference removed package after remove', async () => {
    await installMockPackage('lf-clean', '1.0.0', { 'clean.md': '# clean' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'lf-clean@1.0.0', output: { path: outputDir, gitignore: false } }]);

    await actionInstall({
      entries: [{ package: 'lf-clean@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const lockBefore = readLockfile(tmpDir);
    // files should reference the output dir before removal
    expect(lockBefore?.files).toBeDefined();

    await actionRemove({
      cwd: tmpDir,
      packageSpec: 'lf-clean',
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
    });

    const lockAfter = readLockfile(tmpDir);
    // After removal, no files for the removed package's output dir
    const filesAfter = lockAfter?.files ?? {};
    const allTrackedFiles = Object.values(filesAfter).flat();
    // clean.md should not appear in any files entry
    expect(allTrackedFiles.some((f) => f.includes('clean.md'))).toBe(false);
  }, 60_000);
});

describe('actionRemove — branch coverage', () => {
  it('throws when packageSpec is missing and all is not set', async () => {
    writeConfig([]);
    await expect(
      actionRemove({
        cwd: tmpDir,
        configFilePath: path.join(tmpDir, '.filedistrc.yml'),
        // no packageSpec, no all
      }),
    ).rejects.toThrow('packageSpec is required when all is not true');
  }, 60_000);

  it('removes all entries when all=true with verbose', async () => {
    await installMockPackage('all-v-pkg', '1.0.0', { 'av.md': '# av' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    writeConfig([{ package: 'all-v-pkg@1.0.0', output: { path: outputDir, gitignore: false } }]);
    await actionInstall({
      entries: [{ package: 'all-v-pkg@1.0.0', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      configFilePath: path.join(tmpDir, '.filedistrc.yml'),
      all: true,
      verbose: true,
    });

    expect(result.removedEntries).toBe(1);
    expect(readConfigSets()).toHaveLength(0);
  }, 60_000);

  it('filters by presets when presets option is supplied', async () => {
    await installMockPackage('preset-pkg', '1.0.0', { 'pp.md': '# pp' }, tmpDir);
    const outA = path.join(tmpDir, 'outA');
    const outB = path.join(tmpDir, 'outB');

    const filePath = path.join(tmpDir, '.filedistrc.yml');
    fs.writeFileSync(
      filePath,
      [
        'sets:',
        '  - package: preset-pkg@1.0.0',
        '    presets: [web]',
        '    output:',
        '      path: ' + outA,
        '      gitignore: false',
        '  - package: preset-pkg@1.0.0',
        '    presets: [mobile]',
        '    output:',
        '      path: ' + outB,
        '      gitignore: false',
      ].join('\n'),
      'utf8',
    );

    await actionInstall({
      entries: [
        { package: 'preset-pkg@1.0.0', output: { path: outA, gitignore: false } },
        { package: 'preset-pkg@1.0.0', output: { path: outB, gitignore: false } },
      ],
      cwd: tmpDir,
    });

    const result = await actionRemove({
      cwd: tmpDir,
      packageSpec: 'preset-pkg',
      presets: ['web'],
      configFilePath: filePath,
    });

    expect(result.removedEntries).toBe(1);
    const remaining = readConfigSets() as Array<{ presets?: string[] }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].presets).toContain('mobile');
  }, 60_000);
});
