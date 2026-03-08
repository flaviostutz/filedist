/* eslint-disable unicorn/no-null */
import { cli } from './cli';
import { loadNpmdataConfig } from './config';
import { runExtract } from './commands/extract';
import { runCheck } from './commands/check';
import { runList } from './commands/list';
import { runPurge } from './commands/purge';
import { runInit } from './commands/init';

jest.mock('./config');
jest.mock('./commands/extract', () => ({ runExtract: jest.fn() }));
jest.mock('./commands/check', () => ({ runCheck: jest.fn() }));
jest.mock('./commands/list', () => ({ runList: jest.fn() }));
jest.mock('./commands/purge', () => ({ runPurge: jest.fn() }));
jest.mock('./commands/init', () => ({ runInit: jest.fn() }));

const mockLoadConfig = loadNpmdataConfig as jest.MockedFunction<typeof loadNpmdataConfig>;
const mockRunExtract = runExtract as jest.MockedFunction<typeof runExtract>;
const mockRunCheck = runCheck as jest.MockedFunction<typeof runCheck>;
const mockRunList = runList as jest.MockedFunction<typeof runList>;
const mockRunPurge = runPurge as jest.MockedFunction<typeof runPurge>;
const mockRunInit = runInit as jest.MockedFunction<typeof runInit>;

describe('cli', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadConfig.mockResolvedValue(null);
    mockRunExtract.mockResolvedValue();
    mockRunCheck.mockResolvedValue();
    mockRunList.mockResolvedValue();
    mockRunPurge.mockResolvedValue();
    mockRunInit.mockResolvedValue();
  });

  it('defaults to extract command when no command given', async () => {
    await cli(['node', 'npmdata', '--packages', 'my-pkg']);
    expect(mockRunExtract).toHaveBeenCalledWith(null, ['--packages', 'my-pkg'], expect.any(String));
  });

  it('defaults to extract when first arg starts with -', async () => {
    await cli(['node', 'npmdata', '--dry-run']);
    expect(mockRunExtract).toHaveBeenCalled();
  });

  it('routes to check command', async () => {
    await cli(['node', 'npmdata', 'check']);
    expect(mockRunCheck).toHaveBeenCalled();
  });

  it('routes to list command', async () => {
    await cli(['node', 'npmdata', 'list']);
    expect(mockRunList).toHaveBeenCalled();
  });

  it('routes to purge command', async () => {
    await cli(['node', 'npmdata', 'purge']);
    expect(mockRunPurge).toHaveBeenCalled();
  });

  it('routes to init command', async () => {
    await cli(['node', 'npmdata', 'init']);
    expect(mockRunInit).toHaveBeenCalled();
  });

  it('prints usage and exits 0 on --help alone', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await cli(['node', 'npmdata', '--help']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('prints version on --version', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await cli(['node', 'npmdata', '--version']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
