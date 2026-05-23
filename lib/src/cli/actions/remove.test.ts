import path from 'node:path';
/* eslint-disable @typescript-eslint/no-empty-function */

import { actionRemove } from '../../package/action-remove';
import { ProgressEvent } from '../../types';
import { printUsage } from '../usage';

import { runRemove } from './remove';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('../../package/action-remove', () => ({
  actionRemove: jest.fn(),
}));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;
const mockActionRemove = actionRemove as jest.MockedFunction<typeof actionRemove>;

const DEFAULT_INSTALL = { added: 0, modified: 0, deleted: 0, skipped: 0 };
const DEFAULT_RESULT = { removedEntries: 0, install: DEFAULT_INSTALL };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionRemove.mockResolvedValue(DEFAULT_RESULT);
});

afterEach(() => {
  delete process.exitCode;
});

describe('runRemove — --help', () => {
  it('prints usage and returns without calling actionRemove', async () => {
    await runRemove(
      ['--help'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    expect(mockPrintUsage).toHaveBeenCalledWith('remove');
    expect(mockActionRemove).not.toHaveBeenCalled();
  });
});

describe('runRemove — missing package argument', () => {
  it('sets exitCode=1 and logs error when no package arg is given', async () => {
    const errors: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
    await runRemove(
      [],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
    expect(mockActionRemove).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes('<package>'))).toBe(true);
  });

  it('skips flag-like args and still detects missing package', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await runRemove(
      ['--dry-run', '--verbose'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
  });
});

describe('runRemove — --all flag', () => {
  it('calls actionRemove with all=true when --all is given', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['--all'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove).toHaveBeenCalledTimes(1);
    expect(mockActionRemove.mock.calls[0][0]).toMatchObject({ all: true });
    expect(mockActionRemove.mock.calls[0][0].packageSpec).toBeUndefined();
  });

  it('does not require a package arg when --all is given', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['--all', '--dry-run'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(process.exitCode).toBeUndefined();
    expect(mockActionRemove).toHaveBeenCalled();
  });
});

describe('runRemove — package spec extraction', () => {
  it('passes the first positional arg as packageSpec', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['xdrs-core'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].packageSpec).toBe('xdrs-core');
  });

  it('ignores flag args and picks the positional arg', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['--dry-run', 'my-package'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].packageSpec).toBe('my-package');
  });

  it('skips --output flag value and picks the package name', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['--output', './out', 'target-pkg'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].packageSpec).toBe('target-pkg');
  });
});

describe('runRemove — options forwarding', () => {
  it('passes cwd to actionRemove', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg'],
      '/my/cwd',
      path.join('/my/cwd', '.filedist.lock'),
      path.join('/my/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].cwd).toBe('/my/cwd');
  });

  it('passes dryRun=true when --dry-run flag given', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg', '--dry-run'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].dryRun).toBe(true);
  });

  it('passes verbose=true when --verbose flag given', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg', '--verbose'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].verbose).toBe(true);
  });

  it('passes outputPath when --output flag given', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg', '--output', './docs'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].outputPath).toBe('./docs');
  });

  it('passes configFilePath from caller when --config not in argv', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      '/project/.filedistrc.yml',
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].configFilePath).toBe('/project/.filedistrc.yml');
  });

  it('resolves --config flag to absolute configFilePath', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg', '--config', 'custom.yml'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(mockActionRemove.mock.calls[0][0].configFilePath).toBe('/cwd/custom.yml');
  });
});

describe('runRemove — summary output', () => {
  it('logs summary with removedEntries and install counts', async () => {
    mockActionRemove.mockResolvedValue({
      removedEntries: 2,
      install: { added: 0, modified: 0, deleted: 3, skipped: 0 },
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runRemove(
      ['my-pkg'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(
      logs.some((l) => l.includes('2 config entries removed') && l.includes('3 deleted')),
    ).toBe(true);
  });

  it('does not set exitCode on success', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runRemove(
      ['my-pkg'],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    spy.mockRestore();
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runRemove — onProgress handler', () => {
  const runWithEvent = async (event: ProgressEvent, argv: string[] = []): Promise<string[]> => {
    let capturedOnProgress: ((e: ProgressEvent) => void) | undefined;
    mockActionRemove.mockImplementation(async ({ onProgress }) => {
      capturedOnProgress = onProgress;
      return DEFAULT_RESULT;
    });

    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await runRemove(
      ['my-pkg', ...argv],
      '/cwd',
      path.join('/cwd', '.filedist.lock'),
      path.join('/cwd', '.filedist.yml'),
    );
    capturedOnProgress!(event);
    spy.mockRestore();
    return logs;
  };

  it('logs file-deleted event with - prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-deleted',
      packageName: 'my-pkg',
      file: 'docs/a.md',
      managed: true,
      gitignore: true,
    });
    expect(logs.some((l) => l.startsWith('  -'))).toBe(true);
  });

  it('logs file-added event with + prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'my-pkg',
      file: 'docs/b.md',
      managed: true,
      gitignore: true,
    });
    expect(logs.some((l) => l.startsWith('  +'))).toBe(true);
  });

  it('suppresses progress output when --silent flag given', async () => {
    const logs = await runWithEvent(
      {
        type: 'file-deleted',
        packageName: 'my-pkg',
        file: 'docs/c.md',
        managed: true,
        gitignore: true,
      },
      ['--silent'],
    );
    // Summary log is present, but per-file progress log is suppressed
    const progressLogs = logs.filter((l) => l.startsWith('  -'));
    expect(progressLogs).toHaveLength(0);
  });
});
