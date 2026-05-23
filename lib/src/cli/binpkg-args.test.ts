import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('./cli', () => ({
  cli: jest.fn().mockResolvedValue(0),
  setupUncaughtExceptionHandler: jest.fn(),
}));

import { cli } from './cli';
import { binpkg } from './binpkg';

const mockCli = cli as jest.MockedFunction<typeof cli>;

describe('binpkg defaultPresets forwarding', () => {
  let tmpDir: string;
  let binDir: string;
  let exitSpy: jest.SpyInstance;
  let originalCwd: string;

  beforeEach(() => {
    jest.clearAllMocks();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binpkg-args-test-'));
    binDir = path.join(tmpDir, 'pkg', 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    originalCwd = process.cwd();
    process.chdir(tmpDir);

    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 'undefined'})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('injects defaultPresets when the user does not pass --presets', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'package.json'),
      JSON.stringify({ name: 'example-files-package', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', '.filedist-package.yml'),
      'defaultPresets:\n  - basic\n  - eslint\n',
    );

    await expect(binpkg(binDir, ['install', '--output', 'output'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(mockCli).toHaveBeenCalledWith(
      [
        'node',
        'filedist',
        'install',
        'example-files-package',
        '--output',
        'output',
        '--presets',
        'basic,eslint',
      ],
      process.cwd(),
    );
  });

  it('does not inject defaultPresets when the user already passed --presets', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'package.json'),
      JSON.stringify({ name: 'example-files-package', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', '.filedist-package.yml'),
      'defaultPresets:\n  - basic\n',
    );

    await expect(
      binpkg(binDir, ['install', '--output', 'output', '--presets', 'special']),
    ).rejects.toThrow('process.exit(0)');

    expect(mockCli).toHaveBeenCalledWith(
      [
        'node',
        'filedist',
        'install',
        'example-files-package',
        '--output',
        'output',
        '--presets',
        'special',
      ],
      process.cwd(),
    );
  });

  it('does not inject defaultPresets when the user passes --all', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'package.json'),
      JSON.stringify({ name: 'example-files-package', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', '.filedist-package.yml'),
      'defaultPresets:\n  - basic\n',
    );

    await expect(binpkg(binDir, ['install', '--output', 'output', '--all'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(mockCli).toHaveBeenCalledWith(
      ['node', 'filedist', 'install', 'example-files-package', '--output', 'output', '--all'],
      process.cwd(),
    );
  });
});
