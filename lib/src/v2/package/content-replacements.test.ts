import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { applyContentReplacementsToBuffer, applyContentReplacements } from './content-replacements';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-cr-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('applyContentReplacementsToBuffer', () => {
  it('replaces a simple string', () => {
    const result = applyContentReplacementsToBuffer('Hello World', [
      { files: '*.md', match: 'World', replace: 'npmdata' },
    ]);
    expect(result).toBe('Hello npmdata');
  });

  it('applies multiple replacements in order', () => {
    const result = applyContentReplacementsToBuffer('foo bar', [
      { files: '*.md', match: 'foo', replace: 'baz' },
      { files: '*.md', match: 'bar', replace: 'qux' },
    ]);
    expect(result).toBe('baz qux');
  });

  it('replaces all occurrences (global flag)', () => {
    const result = applyContentReplacementsToBuffer('a-a-a', [
      { files: '*.md', match: 'a', replace: 'b' },
    ]);
    expect(result).toBe('b-b-b');
  });

  it('supports regex patterns', () => {
    const result = applyContentReplacementsToBuffer('version: 1.2.3', [
      { files: '*.md', match: '\\d+\\.\\d+\\.\\d+', replace: 'X.Y.Z' },
    ]);
    expect(result).toBe('version: X.Y.Z');
  });

  it('returns original content when no replacements match', () => {
    const result = applyContentReplacementsToBuffer('unchanged', [
      { files: '*.md', match: 'nothere', replace: 'x' },
    ]);
    expect(result).toBe('unchanged');
  });

  it('returns original content when replacements array is empty', () => {
    const result = applyContentReplacementsToBuffer('hello', []);
    expect(result).toBe('hello');
  });
});

describe('applyContentReplacements', () => {
  it('applies replacement to matching files on disk', async () => {
    const filePath = path.join(tmpDir, 'README.md');
    fs.writeFileSync(filePath, 'Hello World');

    await applyContentReplacements(tmpDir, [{ files: '*.md', match: 'World', replace: 'npmdata' }]);

    expect(fs.readFileSync(filePath, 'utf8')).toBe('Hello npmdata');
  });

  it('no-ops when replacements array is empty', async () => {
    const filePath = path.join(tmpDir, 'README.md');
    fs.writeFileSync(filePath, 'Hello World');

    await applyContentReplacements(tmpDir, []);

    expect(fs.readFileSync(filePath, 'utf8')).toBe('Hello World');
  });

  it('restores read-only permission after modifying read-only files', async () => {
    const filePath = path.join(tmpDir, 'locked.md');
    fs.writeFileSync(filePath, 'Hello World');
    fs.chmodSync(filePath, 0o444); // make read-only

    await applyContentReplacements(tmpDir, [{ files: '*.md', match: 'World', replace: 'done' }]);

    const stat = fs.statSync(filePath);
    // eslint-disable-next-line no-bitwise
    const isReadOnly = (stat.mode & 0o200) === 0;
    expect(fs.readFileSync(filePath, 'utf8')).toBe('Hello done');
    expect(isReadOnly).toBe(true);
  });

  it('skips files that do not match the glob', async () => {
    const mdFile = path.join(tmpDir, 'README.md');
    const tsFile = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(mdFile, 'Hello World');
    fs.writeFileSync(tsFile, 'Hello World');

    await applyContentReplacements(tmpDir, [{ files: '*.md', match: 'World', replace: 'done' }]);

    expect(fs.readFileSync(tsFile, 'utf8')).toBe('Hello World');
    expect(fs.readFileSync(mdFile, 'utf8')).toBe('Hello done');
  });

  it('recurses into subdirectories to find matching files', async () => {
    const subDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'guide.md');
    fs.writeFileSync(subFile, 'Hello World');

    await applyContentReplacements(tmpDir, [
      { files: 'docs/*.md', match: 'World', replace: 'docs' },
    ]);

    expect(fs.readFileSync(subFile, 'utf8')).toBe('Hello docs');
  });

  it('skips symlinks during file collection', async () => {
    const realFile = path.join(tmpDir, 'real.md');
    fs.writeFileSync(realFile, 'original');
    // Create a symlink to the real file — should be skipped during collection
    const linkFile = path.join(tmpDir, 'link.md');
    fs.symlinkSync(realFile, linkFile);

    await applyContentReplacements(tmpDir, [
      { files: '*.md', match: 'original', replace: 'changed' },
    ]);

    // The real file is updated; symlink is skipped so the symlink target file content depends
    // on real.md being updated directly (not via the symlink path)
    expect(fs.readFileSync(realFile, 'utf8')).toBe('changed');
  });
});
