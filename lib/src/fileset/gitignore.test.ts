import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { addToGitignore, removeFromGitignore } from './gitignore';
import { MARKER_FILE, GITIGNORE_FILE } from './constants';

describe('addToGitignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-gitignore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates .gitignore from scratch with managed section', async () => {
    await addToGitignore(tmpDir, ['docs/file.md', 'README.md']);
    const content = fs.readFileSync(path.join(tmpDir, GITIGNORE_FILE), 'utf8');
    expect(content).toContain('# filedist:start');
    expect(content).toContain(MARKER_FILE);
    expect(content).toContain('docs/file.md');
    expect(content).toContain('README.md');
    expect(content).toContain('# filedist:end');
  });

  it('appends managed section to existing .gitignore', async () => {
    const gitignorePath = path.join(tmpDir, GITIGNORE_FILE);
    fs.writeFileSync(gitignorePath, 'node_modules/\ndist/\n');
    await addToGitignore(tmpDir, ['docs/file.md']);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).toContain('# filedist:start');
    expect(content).toContain(MARKER_FILE);
    expect(content).toContain('docs/file.md');
  });

  it('replaces existing managed section with updated paths', async () => {
    await addToGitignore(tmpDir, ['old-file.md']);
    await addToGitignore(tmpDir, ['new-file.md']);
    const content = fs.readFileSync(path.join(tmpDir, GITIGNORE_FILE), 'utf8');
    expect(content).not.toContain('old-file.md');
    expect(content).toContain('new-file.md');
  });

  it('sorts paths alphabetically in the managed section', async () => {
    await addToGitignore(tmpDir, ['z-file.md', 'a-file.md', 'm-file.md']);
    const content = fs.readFileSync(path.join(tmpDir, GITIGNORE_FILE), 'utf8');
    const aIdx = content.indexOf('a-file.md');
    const mIdx = content.indexOf('m-file.md');
    const zIdx = content.indexOf('z-file.md');
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });
});

describe('removeFromGitignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-gitignore-remove-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('removes specified paths from managed section', async () => {
    await addToGitignore(tmpDir, ['docs/file.md', 'README.md', 'other.md']);
    await removeFromGitignore(tmpDir, ['docs/file.md']);
    const content = fs.readFileSync(path.join(tmpDir, GITIGNORE_FILE), 'utf8');
    expect(content).not.toContain('docs/file.md');
    expect(content).toContain('README.md');
    expect(content).toContain('other.md');
  });

  it('removes entire managed section when all paths removed', async () => {
    await addToGitignore(tmpDir, ['only-file.md']);
    await removeFromGitignore(tmpDir, ['only-file.md']);
    // File may be deleted or empty — either way, no managed section markers remain
    const gitignorePath = path.join(tmpDir, GITIGNORE_FILE);
    const fileExists = fs.existsSync(gitignorePath);
    const content = fileExists ? fs.readFileSync(gitignorePath, 'utf8') : '';
    expect(content).not.toContain('# filedist:start');
    expect(content).not.toContain('# filedist:end');
  });

  it('deletes .gitignore file when it becomes empty after removal', async () => {
    await addToGitignore(tmpDir, ['only-file.md']);
    await removeFromGitignore(tmpDir, ['only-file.md']);
    const gitignorePath = path.join(tmpDir, GITIGNORE_FILE);
    expect(fs.existsSync(gitignorePath)).toBe(false);
  });

  it('preserves external content when removing managed section', async () => {
    const gitignorePath = path.join(tmpDir, GITIGNORE_FILE);
    fs.writeFileSync(gitignorePath, 'node_modules/\n');
    await addToGitignore(tmpDir, ['only-file.md']);
    await removeFromGitignore(tmpDir, ['only-file.md']);
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).not.toContain('# filedist:start');
  });

  it('does nothing when .gitignore does not exist', async () => {
    await expect(removeFromGitignore(tmpDir, ['file.md'])).resolves.toBeUndefined();
  });
});
