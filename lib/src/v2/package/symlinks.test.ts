import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createSymlinks, removeStaleSymlinks, removeAllSymlinks } from './symlinks';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-symlinks-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createSymlinks', () => {
  it('creates a symlink in the target directory for each matched source', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'README.md'), '# hi');

    const targetDir = path.join(tmpDir, 'links');
    await createSymlinks(outputDir, [{ source: 'docs/README.md', target: '../links' }]);

    const linkPath = path.join(targetDir, 'README.md');
    expect(fs.existsSync(linkPath)).toBe(true);
    const stat = fs.lstatSync(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('overwrites an existing symlink', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'file.md'), 'v1');

    const targetDir = path.join(tmpDir, 'links');
    fs.mkdirSync(targetDir, { recursive: true });
    const linkPath = path.join(targetDir, 'file.md');
    fs.symlinkSync('/dev/null', linkPath);

    await createSymlinks(outputDir, [{ source: 'docs/file.md', target: '../links' }]);
    const target = fs.readlinkSync(linkPath);
    expect(target).not.toBe('/dev/null');
  });

  it('no-ops on empty configs', async () => {
    await expect(createSymlinks(tmpDir, [])).resolves.toBeUndefined();
  });
});

describe('removeStaleSymlinks', () => {
  it('removes symlinks that no longer match their source glob', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });

    const targetDir = path.join(outputDir, 'links');
    fs.mkdirSync(targetDir, { recursive: true });

    // Create a stale symlink (source file no longer matches)
    const staleLink = path.join(targetDir, 'old.md');
    fs.symlinkSync('/dev/null', staleLink);

    // Source glob matches nothing in outputDir
    await removeStaleSymlinks(outputDir, [{ source: 'does-not-match/**', target: 'links' }]);

    // Stale symlink should be removed
    expect(fs.existsSync(staleLink)).toBe(false);
  });

  it('keeps symlinks that still match their source', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'keep.md'), '# keep');

    const targetDir = path.join(outputDir, 'links');
    fs.mkdirSync(targetDir, { recursive: true });

    const keepLink = path.join(targetDir, 'keep.md');
    const relTarget = path.relative(targetDir, path.join(outputDir, 'docs', 'keep.md'));
    fs.symlinkSync(relTarget, keepLink);

    await removeStaleSymlinks(outputDir, [{ source: 'docs/*.md', target: 'links' }]);

    expect(fs.existsSync(keepLink) || fs.lstatSync(keepLink).isSymbolicLink()).toBe(true);
  });
});

describe('removeAllSymlinks', () => {
  it('removes all symlinks pointing into the outputDir', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'target.md'), '# target');

    const linksDir = path.join(outputDir, 'links');
    fs.mkdirSync(linksDir, { recursive: true });

    const relTarget = path.relative(linksDir, path.join(outputDir, 'target.md'));
    fs.symlinkSync(relTarget, path.join(linksDir, 'link.md'));

    const count = await removeAllSymlinks(outputDir);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 when directory does not exist', async () => {
    const count = await removeAllSymlinks(path.join(tmpDir, 'nonexistent'));
    expect(count).toBe(0);
  });

  it('skips symlinks NOT pointing into outputDir', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Create a symlink that points outside outputDir
    const externalTarget = path.join(tmpDir, 'external.md');
    fs.writeFileSync(externalTarget, '# external');
    fs.symlinkSync(externalTarget, path.join(outputDir, 'external-link.md'));

    const count = await removeAllSymlinks(outputDir);
    // The symlink to external target should not be removed
    expect(count).toBe(0);
    expect(fs.existsSync(path.join(outputDir, 'external-link.md'))).toBe(true);
  });

  it('recurses into subdirectories to find and remove symlinks', async () => {
    const outputDir = path.join(tmpDir, 'out');
    const subDir = path.join(outputDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'target.txt'), 'hello');

    // Symlink inside subDir pointing to outputDir file
    const relTarget = path.relative(subDir, path.join(outputDir, 'target.txt'));
    fs.symlinkSync(relTarget, path.join(subDir, 'link.txt'));

    const count = await removeAllSymlinks(outputDir);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(subDir, 'link.txt'))).toBe(false);
  });
});
