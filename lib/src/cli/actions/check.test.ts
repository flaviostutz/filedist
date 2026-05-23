import path from 'node:path';
/* eslint-disable @typescript-eslint/no-empty-function */

import { actionCheck } from '../../package/action-check';
import { printUsage } from '../usage';

import { runCheck } from './check';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('../../package/action-check', () => ({
  actionCheck: jest.fn(),
}));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;
const mockActionCheck = actionCheck as jest.MockedFunction<typeof actionCheck>;

const NO_DRIFT = { ok: 0, missing: [], conflict: [], extra: [] };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionCheck.mockResolvedValue(NO_DRIFT);
});

afterEach(() => {
  delete process.exitCode;
});

describe('runCheck — --help', () => {
  it('prints usage and returns without calling actionCheck', async () => {
    await runCheck(['--help'], '/cwd', path.join('/cwd', '.filedist.lock'));
    expect(mockPrintUsage).toHaveBeenCalledWith('check');
    expect(mockActionCheck).not.toHaveBeenCalled();
  });
});

describe('runCheck — no drift', () => {
  it('does not set exitCode when no drift found', async () => {
    mockActionCheck.mockResolvedValue(NO_DRIFT);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'));
    spy.mockRestore();
    expect(process.exitCode).toBeUndefined();
  });

  it('prints "All managed files are in sync" when no drift', async () => {
    mockActionCheck.mockResolvedValue(NO_DRIFT);
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'));
    spy.mockRestore();
    expect(logs).toContain('All managed files are in sync');
  });
});

describe('runCheck — drift detected', () => {
  it('throws when missing files found', async () => {
    mockActionCheck.mockResolvedValue({ ok: 0, missing: ['docs/a.md'], conflict: [], extra: [] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow(
      'Check failed: some managed files are out of sync',
    );
    spy.mockRestore();
  });

  it('throws when conflict files found', async () => {
    mockActionCheck.mockResolvedValue({ ok: 0, missing: [], conflict: ['docs/b.md'], extra: [] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow(
      'Check failed: some managed files are out of sync',
    );
    spy.mockRestore();
  });

  it('throws when extra files found', async () => {
    mockActionCheck.mockResolvedValue({ ok: 0, missing: [], conflict: [], extra: ['docs/c.md'] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow(
      'Check failed: some managed files are out of sync',
    );
    spy.mockRestore();
  });

  it('logs each missing file prefixed with "missing:"', async () => {
    mockActionCheck.mockResolvedValue({
      ok: 0,
      missing: ['docs/a.md', 'docs/b.md'],
      conflict: [],
      extra: [],
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow();
    spy.mockRestore();
    expect(logs).toContain('missing: docs/a.md');
    expect(logs).toContain('missing: docs/b.md');
  });

  it('logs each conflict file prefixed with "conflict:"', async () => {
    mockActionCheck.mockResolvedValue({
      ok: 0,
      missing: [],
      conflict: ['docs/c.md'],
      extra: [],
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow();
    spy.mockRestore();
    expect(logs).toContain('conflict: docs/c.md');
  });

  it('logs each extra file prefixed with "extra:"', async () => {
    mockActionCheck.mockResolvedValue({
      ok: 0,
      missing: [],
      conflict: [],
      extra: ['docs/d.md'],
    });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow();
    spy.mockRestore();
    expect(logs).toContain('extra: docs/d.md');
  });
});

describe('runCheck — options forwarding', () => {
  it('passes cwd to actionCheck', async () => {
    await runCheck([], '/my/cwd', path.join('/my/cwd', '.filedist.lock'));
    const callArg = mockActionCheck.mock.calls[0][0];
    expect(callArg.cwd).toBe('/my/cwd');
  });

  it('passes frozenLockfile=true to actionCheck', async () => {
    await runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'));
    const callArg = mockActionCheck.mock.calls[0][0];
    expect(callArg.frozenLockfile).toBe(true);
  });

  it('passes empty entries to actionCheck (lockfile provides entries)', async () => {
    await runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'));
    const callArg = mockActionCheck.mock.calls[0][0];
    expect(callArg.entries).toHaveLength(0);
  });

  it('passes verbose=true when --verbose flag given', async () => {
    await runCheck(['--verbose'], '/cwd', path.join('/cwd', '.filedist.lock'));
    expect(mockActionCheck.mock.calls[0][0].verbose).toBe(true);
  });
});

describe('runCheck — error handling', () => {
  it('propagates error when actionCheck throws', async () => {
    mockActionCheck.mockRejectedValue(new Error('check failed'));
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow(
      'check failed',
    );
  });

  it('propagates error message when actionCheck throws', async () => {
    mockActionCheck.mockRejectedValue(new Error('something went wrong'));
    await expect(runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'))).rejects.toThrow(
      'something went wrong',
    );
  });
});

describe('runCheck — --local-only', () => {
  it('passes localOnly=true to actionCheck when --local-only flag is given', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck(['--local-only'], '/cwd', path.join('/cwd', '.filedist.lock'));
    spy.mockRestore();
    expect(mockActionCheck.mock.calls[0][0].localOnly).toBe(true);
  });

  it('passes localOnly=undefined to actionCheck when --local-only flag is absent', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck([], '/cwd', path.join('/cwd', '.filedist.lock'));
    spy.mockRestore();
    expect(mockActionCheck.mock.calls[0][0].localOnly).toBeUndefined();
  });

  it('does not call actionCheck with localOnly when --local-only=false', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runCheck(['--local-only=false'], '/cwd', path.join('/cwd', '.filedist.lock'));
    spy.mockRestore();
    expect(mockActionCheck.mock.calls[0][0].localOnly).toBe(false);
  });
});
