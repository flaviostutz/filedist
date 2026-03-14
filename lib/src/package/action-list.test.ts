import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { writeMarker, markerPath } from '../fileset/markers';

import { actionList } from './action-list';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-action-list-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionList', () => {
  it('returns empty array when marker does not exist', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await actionList({ outputDir: outputDir });
    expect(result).toHaveLength(0);
  });

  it('returns managed files from marker', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const mPath = markerPath(outputDir);
    await writeMarker(mPath, [
      { path: 'README.md', packageName: 'mypkg', packageVersion: '1.0.0' },
      { path: 'docs/guide.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);
    const result = await actionList({ outputDir: outputDir });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.path)).toContain('README.md');
    expect(result.map((r) => r.path)).toContain('docs/guide.md');
  });

  it('deduplicates the same output directory across multiple entries', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const mPath = markerPath(outputDir);
    await writeMarker(mPath, [
      { path: 'README.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    // Two entries pointing to the same output dir
    const result = await actionList({ outputDir: outputDir });
    // Should only read the marker once
    expect(result).toHaveLength(1);
  });

  it('uses explicit output override when provided', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const mPath = markerPath(outputDir);
    await writeMarker(mPath, [{ path: 'a.md', packageName: 'p', packageVersion: '1.0.0' }]);

    const other = path.join(tmpDir, 'other');
    fs.mkdirSync(other, { recursive: true });

    // override points to outputDir
    const result = await actionList({ outputDir: outputDir });
    expect(result.map((r) => r.path)).toContain('a.md');
  });

  it('aggregates from multiple distinct output directories', async () => {
    const out1 = path.join(tmpDir, 'out1');
    const out2 = path.join(tmpDir, 'out2');
    fs.mkdirSync(out1, { recursive: true });
    fs.mkdirSync(out2, { recursive: true });

    await writeMarker(markerPath(out1), [
      { path: 'a.md', packageName: 'pkg1', packageVersion: '1.0.0' },
    ]);
    await writeMarker(markerPath(out2), [
      { path: 'b.md', packageName: 'pkg2', packageVersion: '1.0.0' },
    ]);

    const result = await actionList({ outputDir: out1 });
    expect(result.map((r) => r.path)).toContain('a.md');

    const result2 = await actionList({ outputDir: out2 });
    expect(result2.map((r) => r.path)).toContain('b.md');
  });
});
