import path from 'node:path';
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable unicorn/no-null */

import { actionInstall } from '../../package/action-install';
import { FiledistConfig, ProgressEvent } from '../../types';
import { printUsage } from '../usage';

import { runInstall } from './install';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawnSync: jest.fn().mockReturnValue({
    status: 0,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    // eslint-disable-next-line no-undefined
    error: undefined,
  }),
}));

// eslint-disable-next-line import/no-commonjs, @typescript-eslint/no-require-imports
const { spawnSync: mockSpawnSync } = require('node:child_process') as {
  spawnSync: jest.MockedFunction<typeof import('node:child_process').spawnSync>;
};

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;

jest.mock('../../package/action-install', () => ({
  actionInstall: jest.fn(),
}));
const mockActionInstall = actionInstall as jest.MockedFunction<typeof actionInstall>;

const DEFAULT_RESULT = { added: 1, modified: 0, deleted: 0, skipped: 0 };

const CONFIG_WITH_SETS: FiledistConfig = {
  sets: [
    {
      package: 'config-pkg@1.0.0',
      output: { path: './config-out', force: false, gitignore: true },
      selector: {},
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionInstall.mockResolvedValue(DEFAULT_RESULT);
  mockSpawnSync.mockReturnValue({
    pid: 0,
    output: [],
    // eslint-disable-next-line no-undefined
    error: undefined,
    status: 0,
    signal: null,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
  });
});

afterEach(() => {
  delete process.exitCode;
});

describe('runInstall — source selection', () => {
  it('uses CLI --packages entries when provided, ignoring config sets', async () => {
    await runInstall(
      CONFIG_WITH_SETS,
      ['--packages', 'cli-pkg@2.0.0', '--output', './cli-out', '--gitignore=false'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('cli-pkg@2.0.0');
    expect(entries[0].output!.path).toBe('./cli-out');
  });

  it('uses config sets when --packages is not provided', async () => {
    await runInstall(CONFIG_WITH_SETS, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('config-pkg@1.0.0');
  });

  it('throws when no --packages and config is null', async () => {
    await expect(runInstall(null, [], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow(
      'No packages specified',
    );
    expect(mockActionInstall).not.toHaveBeenCalled();
  });

  it('throws when no --packages and config has empty sets', async () => {
    await expect(
      runInstall({ sets: [] }, [], '/cwd', path.join('/cwd', '.filedist.lock')),
    ).rejects.toThrow('No packages specified');
    expect(mockActionInstall).not.toHaveBeenCalled();
  });

  it('passes multiple config sets when defined', async () => {
    const multiConfig: FiledistConfig = {
      sets: [
        { package: 'pkg-a@1.0.0', output: { path: './a' } },
        { package: 'pkg-b@2.0.0', output: { path: './b' } },
      ],
    };
    await runInstall(multiConfig, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries[0].package).toBe('pkg-a@1.0.0');
    expect(entries[1].package).toBe('pkg-b@2.0.0');
  });
});

describe('runInstall — CLI overrides applied to config entries', () => {
  it('overrides output path with --output', async () => {
    await runInstall(
      CONFIG_WITH_SETS,
      ['--output', './override-out'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.path).toBe('./override-out');
  });

  it('overrides force with --force', async () => {
    await runInstall(CONFIG_WITH_SETS, ['--force'], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.force).toBe(true);
  });

  it('overrides dryRun with --dry-run', async () => {
    await runInstall(CONFIG_WITH_SETS, ['--dry-run'], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.dryRun).toBe(true);
  });

  it('overrides gitignore with --gitignore=false', async () => {
    // Config entry has gitignore: true — CLI flag should override to false
    await runInstall(
      CONFIG_WITH_SETS,
      ['--gitignore=false'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.gitignore).toBe(false);
  });

  it('overrides mutable with --mutable', async () => {
    await runInstall(CONFIG_WITH_SETS, ['--mutable'], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.mutable).toBe(true);
  });

  it('overrides noSync with --nosync', async () => {
    await runInstall(CONFIG_WITH_SETS, ['--nosync'], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.noSync).toBe(true);
  });

  it('overrides silent with --silent', async () => {
    await runInstall(CONFIG_WITH_SETS, ['--silent'], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].silent).toBe(true);
  });

  it('preserves config entry values when no overriding CLI flag given', async () => {
    await runInstall(CONFIG_WITH_SETS, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.path).toBe('./config-out');
    expect(entries[0].output!.force).toBe(false);
    expect(entries[0].output!.gitignore).toBe(true);
  });

  it('applies CLI overrides to all config entries', async () => {
    const multiConfig: FiledistConfig = {
      sets: [
        { package: 'pkg-a@1.0.0', output: { path: './a' } },
        { package: 'pkg-b@2.0.0', output: { path: './b' } },
      ],
    };
    await runInstall(
      multiConfig,
      ['--dry-run', '--silent'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.dryRun).toBe(true);
    expect(entries[0].silent).toBe(true);
    expect(entries[1].output!.dryRun).toBe(true);
    expect(entries[1].silent).toBe(true);
  });
});

describe('runInstall — CLI --packages does not apply applyArgvOverrides redundantly', () => {
  it('embeds CLI flags directly in entries built from --packages', async () => {
    // When --packages is used, flags are already baked in by buildEntriesFromArgv
    await runInstall(
      null,
      ['--packages', 'cli-pkg', '--force', '--dry-run', '--silent', '--gitignore=false'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries[0].output!.force).toBe(true);
    expect(entries[0].output!.dryRun).toBe(true);
    expect(entries[0].output!.gitignore).toBe(false);
    expect(entries[0].silent).toBe(true);
  });
});

describe('runInstall — preset filtering', () => {
  const configWithPresets: FiledistConfig = {
    sets: [
      { package: 'pkg-docs@1.0.0', output: { path: '.' }, selector: { presets: ['docs'] } },
      { package: 'pkg-api@1.0.0', output: { path: '.' }, selector: { presets: ['api'] } },
    ],
  };

  it('passes all config entries when no presets specified', async () => {
    await runInstall(configWithPresets, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries).toHaveLength(2);
  });

  it('filters config entries to matching preset', async () => {
    await runInstall(
      configWithPresets,
      ['--presets', 'docs'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    const { entries } = mockActionInstall.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('pkg-docs@1.0.0');
  });

  it('does not call actionInstall when no entries match preset', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runInstall(
      configWithPresets,
      ['--presets', 'nonexistent'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    spy.mockRestore();
    expect(mockActionInstall).not.toHaveBeenCalled();
  });
});

describe('runInstall — error handling', () => {
  it('throws on invalid argv and skips actionInstall', async () => {
    await expect(
      runInstall(
        CONFIG_WITH_SETS,
        ['--force', '--mutable'],
        '/cwd',
        path.join('/cwd', '.filedist.lock'),
      ),
    ).rejects.toThrow('--force and --mutable are mutually exclusive');
    expect(mockActionInstall).not.toHaveBeenCalled();
  });

  it('propagates error when actionInstall throws', async () => {
    mockActionInstall.mockRejectedValue(new Error('extract failed'));
    await expect(
      runInstall(CONFIG_WITH_SETS, [], '/cwd', path.join('/cwd', '.filedist.lock')),
    ).rejects.toThrow('extract failed');
  });
});

describe('runInstall — --help', () => {
  it('prints usage and returns without calling actionInstall', async () => {
    await runInstall(CONFIG_WITH_SETS, ['--help'], '/cwd', path.join('/cwd', '.filedist.lock'));
    expect(mockPrintUsage).toHaveBeenCalledWith('install');
    expect(mockActionInstall).not.toHaveBeenCalled();
  });
});

describe('runInstall — summary output', () => {
  it('prints correct summary line after successful extract', async () => {
    mockActionInstall.mockResolvedValue({ added: 3, modified: 1, deleted: 2, skipped: 4 });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runInstall(CONFIG_WITH_SETS, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    expect(spy).toHaveBeenCalledWith(
      'Install complete: 3 added, 1 modified, 2 deleted, 4 skipped.',
    );
    spy.mockRestore();
  });

  it('passes cwd and config through to actionInstall', async () => {
    await runInstall(CONFIG_WITH_SETS, [], '/my/cwd', path.join('/my/cwd', '.filedist.lock'));
    const callArg = mockActionInstall.mock.calls[0][0];
    expect(callArg.cwd).toBe('/my/cwd');
  });
});

describe('runInstall — onProgress handler', () => {
  // Helper: capture onProgress, call it with a fake event, check console output
  const runWithEvent = async (event: ProgressEvent, silent = false): Promise<string[]> => {
    let capturedOnProgress: ((e: ProgressEvent) => void) | undefined;
    mockActionInstall.mockImplementation(async ({ onProgress }) => {
      capturedOnProgress = onProgress;
      return DEFAULT_RESULT;
    });

    const config: FiledistConfig = {
      sets: [{ package: 'pkg@1.0.0', output: { path: '.' }, silent }],
    };
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await runInstall(config, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    capturedOnProgress!(event);
    spy.mockRestore();
    return logs;
  };

  it('logs file-added event with + prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/a.md',
      managed: true,
      gitignore: true,
    });
    expect(logs.includes('  + docs/a.md (M,I)')).toBe(true);
  });

  it('logs file-modified event with ~ prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-modified',
      packageName: 'pkg',
      file: 'docs/b.md',
      managed: false,
      gitignore: true,
    });
    expect(logs.includes('  ~ docs/b.md (U,I)')).toBe(true);
  });

  it('logs file-deleted event with - prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-deleted',
      packageName: 'pkg',
      file: 'docs/c.md',
      managed: true,
      gitignore: false,
    });
    expect(logs.includes('  - docs/c.md (M,G)')).toBe(true);
  });

  it('suppresses progress output when entry is silent', async () => {
    const logs = await runWithEvent(
      { type: 'file-added', packageName: 'pkg', file: 'x.md', managed: true, gitignore: true },
      true,
    );
    // Only the summary line should appear, not a progress line
    expect(logs.every((l) => !l.startsWith('  +'))).toBe(true);
  });

  it('ignores file-skipped events (no log)', async () => {
    const logs = await runWithEvent({
      type: 'file-skipped',
      packageName: 'pkg',
      file: 'docs/d.md',
      managed: true,
      gitignore: true,
    });
    expect(logs.every((l) => !l.includes('docs/d.md'))).toBe(true);
  });

  it('renders managed and tracked suffix when gitignore is false', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/e.md',
      managed: true,
      gitignore: false,
    });
    expect(logs.includes('  + docs/e.md (M,G)')).toBe(true);
    expect(logs.every((l) => !l.includes('docs/e.md (M,I)'))).toBe(true);
  });

  it('renders unmanaged and gitignored suffix when only gitignore is true', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/f.md',
      managed: false,
      gitignore: true,
    });
    expect(logs.includes('  + docs/f.md (U,I)')).toBe(true);
  });

  it('renders unmanaged and tracked suffix when neither flag is true', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/g.md',
      managed: false,
      gitignore: false,
    });
    expect(logs.includes('  + docs/g.md (U,G)')).toBe(true);
  });
});

describe('runInstall — postExtractCmd', () => {
  const configWithArrayCmd: FiledistConfig = {
    sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
    postExtractCmd: ['node', 'scripts/post-extract.js'],
  };

  it('runs array postExtractCmd without shell', async () => {
    await runInstall(configWithArrayCmd, ['--silent'], '/cwd', path.join('/cwd', '.filedist.lock'));
    expect(mockSpawnSync).toHaveBeenCalledWith('node', ['scripts/post-extract.js', '--silent'], {
      cwd: '/cwd',
      stdio: 'pipe',
      encoding: 'utf8',
    });
  });

  it('throws when postExtractCmd is a string instead of an argv array', async () => {
    await expect(
      runInstall(
        {
          sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
          postExtractCmd: 'node scripts/post-extract.js' as unknown as string[],
        },
        [],
        '/cwd',
        path.join('/cwd', '.filedist.lock'),
      ),
    ).rejects.toThrow(
      '"postExtractCmd" must be an array of strings, for example ["node", "scripts/post-extract.js"]. ' +
        'Shell strings like "node scripts/post-extract.js" are not supported.',
    );
  });

  it('throws when postExtractCmd array is empty', async () => {
    await expect(
      runInstall(
        {
          sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
          postExtractCmd: [],
        },
        [],
        '/cwd',
        path.join('/cwd', '.filedist.lock'),
      ),
    ).rejects.toThrow('"postExtractCmd" must include the executable as the first array item');
  });

  it('throws when legacy postExtractScript is still present', async () => {
    await expect(
      runInstall(
        {
          sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
          postExtractScript: ['node', 'scripts/post-extract.js'],
        } as FiledistConfig & { postExtractScript: string[] },
        [],
        '/cwd',
        path.join('/cwd', '.filedist.lock'),
      ),
    ).rejects.toThrow(
      '"postExtractScript" was renamed to "postExtractCmd". Use "postExtractCmd": ["node", "scripts/post-extract.js"].',
    );
  });

  it('does not run postExtractCmd when --dry-run', async () => {
    await runInstall(
      configWithArrayCmd,
      ['--dry-run'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
    );
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('does not run postExtractCmd when config has no command', async () => {
    await runInstall(CONFIG_WITH_SETS, [], '/cwd', path.join('/cwd', '.filedist.lock'));
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('throws the OS error when spawnSync returns an error object', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: null,
      error: new Error('spawn ENOENT'),
    });
    await expect(
      runInstall(configWithArrayCmd, [], '/cwd', path.join('/cwd', '.filedist.lock')),
    ).rejects.toThrow('spawn ENOENT');
  });

  it('does not throw when spawnSync exits with non-zero status but no OS error', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: 0,
      signal: null,
      // eslint-disable-next-line no-undefined
      error: undefined,
    });
    await expect(
      runInstall(configWithArrayCmd, [], '/cwd', path.join('/cwd', '.filedist.lock')),
    ).resolves.toBeUndefined();
  });

  it('does not print summary after script failure', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: null,
      error: new Error('fail'),
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(
      runInstall(configWithArrayCmd, [], '/cwd', path.join('/cwd', '.filedist.lock')),
    ).rejects.toThrow();
    spy.mockRestore();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Extract complete'));
  });
});
