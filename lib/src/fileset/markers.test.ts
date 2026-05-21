import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { readMarker, writeMarker, markerPath, readOutputDirMarker } from './markers';
import { MARKER_FILE } from './constants';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-markers-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('markerPath', () => {
  it('returns the path to the marker file in the given directory', () => {
    const result = markerPath('/some/dir');
    expect(result).toBe(path.join('/some/dir', MARKER_FILE));
  });
});

describe('readMarker', () => {
  it('returns empty array when marker file does not exist', async () => {
    const result = await readMarker(path.join(tmpDir, '.filedist'));
    expect(result).toEqual([]);
  });

  it('parses CSV rows into ManagedFileMetadata entries', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(
      mPath,
      'README.md|mypkg|1.0.0|file|cksum1|0\ndocs/guide.md|mypkg|1.0.0|file|cksum2|0\n',
    );
    const result = await readMarker(mPath);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('README.md');
    expect(result[0].packageName).toBe('mypkg');
    expect(result[0].packageVersion).toBe('1.0.0');
    expect(result[0].kind).toBe('file');
    expect(result[0].checksum).toBe('cksum1');
    expect(result[0].mutable).toBe(false);
    expect(result[1].path).toBe('docs/guide.md');
    expect(result[1].kind).toBe('file');
    expect(result[1].checksum).toBe('cksum2');
    expect(result[1].mutable).toBe(false);
  });

  it('skips blank lines in marker file', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'a.md|pkg|1.0.0|file|ck1|0\n\nb.md|pkg|1.0.0|file|ck2|0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(2);
  });

  it('falls back to empty string for missing fields in malformed rows', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    // Line with only one field — packageName and packageVersion will be undefined → ''
    fs.writeFileSync(mPath, 'only-path\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('only-path');
    expect(result[0].packageName).toBe('');
    expect(result[0].packageVersion).toBe('');
    expect(result[0].kind).toBe('file');
  });

  it('correctly parses file paths that contain commas', async () => {
    // Pipe separator means commas in file paths are never ambiguous.
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'src/my,util.ts|mypkg|1.0.0|file|abc123|0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/my,util.ts');
    expect(result[0].packageName).toBe('mypkg');
    expect(result[0].packageVersion).toBe('1.0.0');
    expect(result[0].kind).toBe('file');
  });

  it('parses symlink entries with a kind field', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'links/guide.md|mypkg|1.0.0|symlink|abc123|0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('links/guide.md');
    expect(result[0].packageName).toBe('mypkg');
    expect(result[0].packageVersion).toBe('1.0.0');
    expect(result[0].kind).toBe('symlink');
    expect(result[0].checksum).toBe('abc123');
    expect(result[0].mutable).toBe(false);
  });

  it('parses checksum field for regular files', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'README.md|mypkg|1.0.0|file|abc123\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(1);
    expect(result[0].checksum).toBe('abc123');
    expect(result[0].kind).toBe('file');
    expect(result[0].mutable).toBe(false);
  });

  it('parses checksum field for symlink entries', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'link/a.md|mypkg|1.0.0|symlink|deadbeef\n');
    const result = await readMarker(mPath);
    expect(result[0].kind).toBe('symlink');
    expect(result[0].checksum).toBe('deadbeef');
    expect(result[0].mutable).toBe(false);
  });

  it('parses mutable flag', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'README.md|mypkg|1.0.0|file|abc123|1\n');
    const result = await readMarker(mPath);
    expect(result[0].checksum).toBe('abc123');
    expect(result[0].mutable).toBe(true);
  });

  it('parses mutable=0 as not mutable', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    fs.writeFileSync(mPath, 'README.md|mypkg|1.0.0|file|abc123|0\n');
    const result = await readMarker(mPath);
    expect(result[0].mutable).toBe(false);
  });
});

describe('writeMarker', () => {
  it('creates a marker file with pipe-separated rows and makes it read-only', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    expect(fs.existsSync(mPath)).toBe(true);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('README.md|mypkg|1.2.3');
    const stat = fs.statSync(mPath);
    // read-only: owner write bit should be off

    expect(stat.mode & 0o200).toBe(0);
  });

  it('writes symlink entries with an explicit kind field', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'links/README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'symlink',
        checksum: 'abc123',
        mutable: false,
      },
    ]);

    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('links/README.md|mypkg|1.2.3|symlink');
  });

  it('writes checksum column for regular files', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('README.md|mypkg|1.2.3|file|abc123');
  });

  it('writes checksum column for symlink entries', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'link/a.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'symlink',
        checksum: 'deadbeef',
        mutable: false,
      },
    ]);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('link/a.md|mypkg|1.2.3|symlink|deadbeef');
  });

  it('writes mutable=1 when set', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'abc123',
        mutable: true,
      },
    ]);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('README.md|mypkg|1.2.3|file|abc123|1');
  });

  it('writes mutable=0 when not set but checksum is present', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('README.md|mypkg|1.2.3|file|abc123|0');
  });

  it('always writes all 6 fields', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const content = fs.readFileSync(mPath, 'utf8');
    // All 6 fields always written; self-checksum row is appended
    expect(content).toContain('README.md|mypkg|1.2.3|file|abc123|0\n');
    expect(content).toMatch(/\.\|[\da-f]{12}/);
  });

  it('removes existing marker file when writing empty entries', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    // Create the file first
    await writeMarker(mPath, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    expect(fs.existsSync(mPath)).toBe(true);

    // Writing empty entries should delete the file
    await writeMarker(mPath, []);
    expect(fs.existsSync(mPath)).toBe(false);
  });

  it('does nothing when writing empty entries and file does not exist', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, []);
    expect(fs.existsSync(mPath)).toBe(false);
  });

  it('overwrites existing marker file with new entries', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'old.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    await writeMarker(mPath, [
      {
        path: 'new.md',
        packageName: 'pkg',
        packageVersion: '2.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('new.md');
    expect(content).not.toContain('old.md');
  });

  it('creates intermediate directories if they do not exist', async () => {
    const mPath = path.join(tmpDir, 'nested', 'dir', '.filedist');
    await writeMarker(mPath, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    expect(fs.existsSync(mPath)).toBe(true);
  });
});

describe('readOutputDirMarker', () => {
  it('returns empty array when no marker exists in output dir', async () => {
    const result = await readOutputDirMarker(tmpDir);
    expect(result).toEqual([]);
  });

  it('reads entries from the output dir marker file', async () => {
    const mPath = markerPath(tmpDir);
    await writeMarker(mPath, [
      {
        path: 'doc.md',
        packageName: 'p',
        packageVersion: '0.1.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const result = await readOutputDirMarker(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('doc.md');
  });
});

describe('self-checksum (writeMarker + readMarker round-trip)', () => {
  it('appends a .|<hash> self-checksum row after entry rows', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    const raw = fs.readFileSync(mPath, 'utf8');
    expect(raw).toMatch(/\.\|[\da-f]{12}/);
  });

  it('round-trips correctly: readMarker returns original entries', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    const entries: import('../types').ManagedFileMetadata[] = [
      {
        path: 'README.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
      {
        path: 'docs/guide.md',
        packageName: 'mypkg',
        packageVersion: '1.2.3',
        kind: 'file',
        checksum: 'def456',
        mutable: false,
      },
    ];
    await writeMarker(mPath, entries);
    const result = await readMarker(mPath);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('README.md');
    expect(result[0].checksum).toBe('abc123');
    expect(result[1].path).toBe('docs/guide.md');
    expect(result[1].checksum).toBe('def456');
  });

  it('throws when the self-checksum row is tampered', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    // Make writable so we can tamper
    fs.chmodSync(mPath, 0o644);
    const raw = fs.readFileSync(mPath, 'utf8');
    const tampered = raw.replace(
      /\.\|[\da-f]+/,
      '.|0000000000000000000000000000000000000000000000000000000000000000',
    );
    fs.writeFileSync(mPath, tampered);
    await expect(readMarker(mPath)).rejects.toThrow('tampered');
  });

  it('throws when entry lines are tampered (checksum no longer matches)', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    await writeMarker(mPath, [
      {
        path: 'a.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'file',
        checksum: 'abc123',
        mutable: false,
      },
    ]);
    fs.chmodSync(mPath, 0o644);
    const raw = fs.readFileSync(mPath, 'utf8');
    // Replace entry content to simulate tampering
    const tampered = raw.replace('a.md|pkg|1.0.0', 'evil.md|pkg|1.0.0');
    fs.writeFileSync(mPath, tampered);
    await expect(readMarker(mPath)).rejects.toThrow('tampered');
  });

  it('reads legacy markers without a self-checksum line without error', async () => {
    const mPath = path.join(tmpDir, '.filedist');
    // Write directly without checksum (legacy format)
    fs.writeFileSync(mPath, 'README.md|mypkg|1.0.0\ndocs/guide.md|mypkg|1.0.0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('README.md');
  });
});
