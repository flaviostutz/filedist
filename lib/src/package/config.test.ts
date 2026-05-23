import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import { upsertFiledistConfigEntries } from './config';

describe('upsertFiledistConfigEntries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('appends a new entry when the config file does not exist', async () => {
    await upsertFiledistConfigEntries(tmpDir, path.join(tmpDir, '.filedist.yml'), [
      { package: 'chalk@4', output: { path: 'output/chalk' } },
    ]);

    const saved = yaml.load(fs.readFileSync(path.join(tmpDir, '.filedist.yml'), 'utf8')) as {
      sets: unknown[];
    };
    expect(saved.sets).toHaveLength(1);
    expect(saved.sets[0]).toMatchObject({ package: 'chalk@4' });
  });

  it('replaces an existing entry with the same base name (exact version match)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.filedist.yml'),
      yaml.dump({ sets: [{ package: 'chalk@3', output: { path: 'output/chalk' } }] }),
    );

    await upsertFiledistConfigEntries(tmpDir, path.join(tmpDir, '.filedist.yml'), [
      { package: 'chalk@4', output: { path: 'output/chalk' } },
    ]);

    const saved = yaml.load(fs.readFileSync(path.join(tmpDir, '.filedist.yml'), 'utf8')) as {
      sets: unknown[];
    };
    expect(saved.sets).toHaveLength(1);
    expect(saved.sets[0]).toMatchObject({ package: 'chalk@4' });
  });

  it('removes all entries for the same base package and keeps only one', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.filedist.yml'),
      yaml.dump({
        sets: [
          { package: 'eslint@7', output: { path: 'output/eslint' } },
          { package: 'chalk@3', output: { path: 'output/chalk' } },
          { package: 'chalk@4', output: { path: 'output/chalk-v4' } },
          { package: 'prettier@2', output: { path: 'output/prettier' } },
        ],
      }),
    );

    await upsertFiledistConfigEntries(tmpDir, path.join(tmpDir, '.filedist.yml'), [
      { package: 'chalk@5', output: { path: 'output/chalk-v5' } },
    ]);

    const saved = yaml.load(fs.readFileSync(path.join(tmpDir, '.filedist.yml'), 'utf8')) as {
      sets: Array<{ package: string }>;
    };

    // Both chalk@3 and chalk@4 are gone; chalk@5 is the only chalk entry
    expect(saved.sets.filter((e) => e.package.startsWith('chalk'))).toHaveLength(1);
    expect(saved.sets.find((e) => e.package.startsWith('chalk'))).toMatchObject({
      package: 'chalk@5',
    });
    // Unrelated entries are untouched
    expect(saved.sets.some((e) => e.package === 'eslint@7')).toBe(true);
    expect(saved.sets.some((e) => e.package === 'prettier@2')).toBe(true);
    // Total count: eslint@7, chalk@5, prettier@2
    expect(saved.sets).toHaveLength(3);
  });

  it('inserts the replacement at the position of the first removed entry', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.filedist.yml'),
      yaml.dump({
        sets: [
          { package: 'a@1' },
          { package: 'chalk@3' },
          { package: 'chalk@4' },
          { package: 'z@1' },
        ],
      }),
    );

    await upsertFiledistConfigEntries(tmpDir, path.join(tmpDir, '.filedist.yml'), [
      { package: 'chalk@5' },
    ]);

    const saved = yaml.load(fs.readFileSync(path.join(tmpDir, '.filedist.yml'), 'utf8')) as {
      sets: Array<{ package: string }>;
    };

    expect(saved.sets.map((e) => e.package)).toEqual(['a@1', 'chalk@5', 'z@1']);
  });

  it('does not write file when the single entry is already identical', async () => {
    const filePath = path.join(tmpDir, '.filedist.yml');
    fs.writeFileSync(
      filePath,
      yaml.dump({ sets: [{ package: 'chalk@4', output: { path: 'output/chalk' } }] }),
    );
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    await upsertFiledistConfigEntries(tmpDir, path.join(tmpDir, '.filedist.yml'), [
      { package: 'chalk@4', output: { path: 'output/chalk' } },
    ]);

    // mtime should be unchanged since nothing was written
    expect(fs.statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });
});
