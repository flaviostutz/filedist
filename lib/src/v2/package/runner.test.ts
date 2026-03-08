import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { run } from './runner';
import { actionExtract } from './action-extract';
import { actionCheck } from './action-check';
import { actionList } from './action-list';
import { actionPurge } from './action-purge';

// Mock action modules before importing runner
jest.mock('./action-extract', () => ({ actionExtract: jest.fn().mockResolvedValue({}) }));
jest.mock('./action-check', () => ({
  actionCheck: jest.fn().mockResolvedValue({ missing: [], modified: [], extra: [] }),
}));
jest.mock('./action-list', () => ({ actionList: jest.fn().mockResolvedValue([]) }));
jest.mock('./action-purge', () => ({
  actionPurge: jest.fn().mockResolvedValue({ deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 }),
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-runner-'));
  jest.clearAllMocks();
  delete process.exitCode;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.exitCode;
});

const makeBinDir = (pkgJson: object): string => {
  const pkgDir = path.join(tmpDir, 'mypkg');
  const binDir = path.join(pkgDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson));
  return binDir;
};

describe('runner.run', () => {
  it('defaults to extract command with no argv', async () => {
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, []);
    expect(actionExtract).toHaveBeenCalledTimes(1);
  });

  it('routes "check" command', async () => {
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, ['check']);
    expect(actionCheck).toHaveBeenCalledTimes(1);
  });

  it('routes "list" command', async () => {
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, ['list']);
    expect(actionList).toHaveBeenCalledTimes(1);
  });

  it('routes "purge" command', async () => {
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, ['purge']);
    expect(actionPurge).toHaveBeenCalledTimes(1);
  });

  it('reads sets from package.json when defined', async () => {
    const binDir = makeBinDir({
      name: 'mypkg',
      npmdata: {
        sets: [{ package: 'dep@1.0.0', output: { path: 'out' } }],
      },
    });
    await run(binDir, []);
    expect(actionExtract).toHaveBeenCalledTimes(1);
    const callArg = (actionExtract as jest.Mock).mock.calls[0][0];
    expect(callArg.entries[0].package).toBe('dep@1.0.0');
  });

  it('uses package name as fallback single entry when no sets defined', async () => {
    const binDir = makeBinDir({ name: 'fallback-pkg' });
    await run(binDir, []);
    const callArg = (actionExtract as jest.Mock).mock.calls[0][0];
    expect(callArg.entries[0].package).toBe('fallback-pkg');
  });

  it('handles invalid argv flag gracefully (sets exitCode=1)', async () => {
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, ['--force', '--keep-existing']); // mutually exclusive
    expect(process.exitCode).toBe(1);
  });

  it('falls back gracefully when package.json not found', async () => {
    const binDir = path.join(tmpDir, 'nopkg', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    // No package.json
    await run(binDir, []);
    // Should still call extract using dirname as package name
    expect(actionExtract).toHaveBeenCalledTimes(1);
  });

  it('sets exitCode=1 on check with drift', async () => {
    (actionCheck as jest.Mock).mockResolvedValue({ missing: ['a.md'], modified: [], extra: [] });
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, ['check']);
    expect(process.exitCode).toBe(1);
  });

  it('does not set exitCode on check with no drift', async () => {
    (actionCheck as jest.Mock).mockResolvedValue({ missing: [], modified: [], extra: [] });
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, ['check']);
    expect(process.exitCode).toBeUndefined();
  });

  it('sets exitCode=1 when action throws an error', async () => {
    (actionExtract as jest.Mock).mockRejectedValue(new Error('oops'));
    const binDir = makeBinDir({ name: 'mypkg' });
    await run(binDir, []);
    expect(process.exitCode).toBe(1);
  });
});
