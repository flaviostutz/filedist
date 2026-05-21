import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { installMockPackage } from '../fileset/test-utils';

import { actionInstall } from './action-install';
import { actionUpdate } from './action-update';
import { readLockfile } from './lockfile';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-action-update-'));
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

describe('actionUpdate', () => {
  it('installs files from the updated package version into the output directory', async () => {
    await installMockPackage('update-files-pkg', '1.0.0', { 'docs/v1.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    // Initial install with v1
    await actionInstall({
      entries: [{ package: 'update-files-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });
    expect(fs.existsSync(path.join(outputDir, 'docs/v1.md'))).toBe(true);

    // Publish v2 (replaces in node_modules)
    await installMockPackage('update-files-pkg', '2.0.0', { 'docs/v2.md': '# v2' }, tmpDir);

    // Update using user-supplied entries; upgrade:false avoids registry access in tests
    // (installMockPackage already put v2 in node_modules, simulating a registry upgrade)
    const result = await actionUpdate({
      entries: [{ package: 'update-files-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      upgrade: false,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs/v2.md'))).toBe(true);
  }, 90_000);

  it('updates the lockfile with the new resolved package version', async () => {
    await installMockPackage('update-lock-pkg', '1.0.0', { 'file.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    await actionInstall({
      entries: [{ package: 'update-lock-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    const lockBefore = readLockfile(tmpDir);
    expect(lockBefore?.packages['update-lock-pkg']?.ref).toBe('1.0.0');

    // Publish v2
    await installMockPackage('update-lock-pkg', '2.0.0', { 'file.md': '# v2' }, tmpDir);

    await actionUpdate({
      entries: [{ package: 'update-lock-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
      upgrade: false,
    });

    const lockAfter = readLockfile(tmpDir);
    expect(lockAfter?.packages['update-lock-pkg']?.ref).toBe('2.0.0');
  }, 90_000);

  it('uses user-supplied entries over lockfile sets (like install)', async () => {
    await installMockPackage('update-config-a', '1.0.0', { 'a.md': '# A' }, tmpDir);
    await installMockPackage('update-config-b', '1.0.0', { 'b.md': '# B' }, tmpDir);

    const outputA = path.join(tmpDir, 'out-a');
    const outputB = path.join(tmpDir, 'out-b');

    // First install only pkg-a → lockfile.sets=[pkg-a]
    await actionInstall({
      entries: [{ package: 'update-config-a', output: { path: outputA, gitignore: false } }],
      cwd: tmpDir,
    });

    // Now user has updated their config to include pkg-b as well
    // actionUpdate should use these new entries (user config), not the old lockfile sets
    const result = await actionUpdate({
      entries: [
        { package: 'update-config-a', output: { path: outputA, gitignore: false } },
        { package: 'update-config-b', output: { path: outputB, gitignore: false } },
      ],
      cwd: tmpDir,
      upgrade: false,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputA, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputB, 'b.md'))).toBe(true);

    // Lockfile sets should now include both packages
    const lock = readLockfile(tmpDir);
    expect(lock?.sets).toHaveLength(2);
  }, 90_000);

  it('falls back to lockfile sets when no entries are provided', async () => {
    await installMockPackage('update-fallback-pkg', '1.0.0', { 'doc.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    await actionInstall({
      entries: [{ package: 'update-fallback-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    // Publish v2
    await installMockPackage('update-fallback-pkg', '2.0.0', { 'doc.md': '# v2' }, tmpDir);

    // Call update WITHOUT entries — must read lockfile sets; upgrade:false avoids registry
    const result = await actionUpdate({ cwd: tmpDir, upgrade: false });

    expect(result.modified).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(outputDir, 'doc.md'), 'utf8')).toBe('# v2');
  }, 90_000);

  it('throws when no entries and no lockfile exists', async () => {
    await expect(actionUpdate({ cwd: tmpDir })).rejects.toThrow();
  });

  it('dry-run reports changes without writing files', async () => {
    await installMockPackage('update-dry-pkg', '1.0.0', { 'v1.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');

    await actionInstall({
      entries: [{ package: 'update-dry-pkg', output: { path: outputDir, gitignore: false } }],
      cwd: tmpDir,
    });

    // Publish v2 with different files
    await installMockPackage('update-dry-pkg', '2.0.0', { 'v2.md': '# v2' }, tmpDir);

    const result = await actionUpdate({
      entries: [
        { package: 'update-dry-pkg', output: { path: outputDir, gitignore: false, dryRun: true } },
      ],
      cwd: tmpDir,
      upgrade: false,
    });

    // Changes should be counted but v2.md must not be on disk
    expect(result.added + result.deleted).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'v2.md'))).toBe(false);
  }, 90_000);
});
