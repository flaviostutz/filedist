import { execSync } from 'node:child_process';
import fs from 'node:fs';

import {
  run,
  parseTagsFromArgv,
  filterEntriesByTags,
  collectAllTags,
  printHelp,
  buildPurgeCommand,
} from './runner';
import { NpmdataExtractEntry } from './types';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn(),
}));

type MockedExecSync = jest.MockedFunction<typeof execSync>;
type MockedReadFileSync = jest.MockedFunction<typeof fs.readFileSync>;

const mockExecSync = execSync as MockedExecSync;
const mockReadFileSync = fs.readFileSync as MockedReadFileSync;

const BIN_DIR = '/fake/bin';
const EXTRACT_ARGV = ['node', 'script.js', 'extract'];

/** Capture the command string passed to execSync for the first call. */
function capturedCommand(): string {
  return mockExecSync.mock.calls[0][0] as string;
}

/** Capture all command strings passed to execSync across all calls. */
function capturedCommands(): string[] {
  return mockExecSync.mock.calls.map((call) => call[0] as string);
}

function setupPackageJson(content: Record<string, unknown>): void {
  mockReadFileSync.mockReturnValue(Buffer.from(JSON.stringify(content)));
}

describe('runner', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('run – entry resolution', () => {
    it('uses a single default entry when npmdata is absent', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
      expect(capturedCommand()).toContain('--output "."');
    });

    it('uses a single default entry when npmdata is an empty array', () => {
      setupPackageJson({ name: 'my-pkg', npmdata: [] });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('--packages "my-pkg"');
    });

    it('invokes execSync once per npmdata entry', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a' },
          { package: 'pkg-b', outputDir: './b' },
        ],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('passes stdio:inherit to execSync', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(mockExecSync).toHaveBeenCalledWith(expect.any(String), { stdio: 'inherit' });
    });

    it('resolves the CLI path and embeds it in the command', () => {
      setupPackageJson({ name: 'my-pkg' });

      run(BIN_DIR, EXTRACT_ARGV);

      // The command must call node with an absolute path to main.js and invoke extract.
      expect(capturedCommand()).toMatch(/node ".+main\.js"/);
      expect(capturedCommand()).toContain('extract');
    });

    it('propagates errors thrown by execSync', () => {
      setupPackageJson({ name: 'my-pkg' });
      mockExecSync.mockImplementation(() => {
        throw new Error('command failed');
      });

      expect(() => run(BIN_DIR, EXTRACT_ARGV)).toThrow('command failed');
    });
  });

  describe('buildExtractCommand – flag assembly', () => {
    it('builds a minimal command with only required fields', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: './out' }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      const cmd = capturedCommand();
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).toContain('--output "./out"');
      expect(cmd).not.toContain('--force');
      expect(cmd).not.toContain('--no-gitignore');
      expect(cmd).not.toContain('--unmanaged');
      expect(cmd).not.toContain('--silent');
      expect(cmd).not.toContain('--dry-run');
      expect(cmd).not.toContain('--upgrade');
      expect(cmd).not.toContain('--files');
      expect(cmd).not.toContain('--content-regex');
    });

    it('adds --force when force is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', force: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --force');
    });

    it('omits --force when force is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', force: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--force');
    });

    it('omits --no-gitignore when gitignore is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', gitignore: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--no-gitignore');
    });

    it('adds --no-gitignore when gitignore is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', gitignore: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --no-gitignore');
    });

    it('adds --silent when silent is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', silent: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --silent');
    });

    it('adds --dry-run when dryRun is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', dryRun: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --dry-run');
    });

    it('adds --upgrade when upgrade is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', upgrade: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --upgrade');
    });

    it('adds --unmanaged when unmanaged is true', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', unmanaged: true }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain(' --unmanaged');
    });

    it('omits --unmanaged when unmanaged is false', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', unmanaged: false }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--unmanaged');
    });

    it('adds --files with a single file pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--files "**/*.md"');
    });

    it('joins multiple file patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: ['**/*.md', 'data/**'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--files "**/*.md,data/**"');
    });

    it('omits --files when files array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', files: [] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--files');
    });

    it('adds --content-regex with a single regex pattern', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar"');
    });

    it('joins multiple content regex patterns with a comma', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: ['foo.*bar', '^baz'] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).toContain('--content-regex "foo.*bar,^baz"');
    });

    it('omits --content-regex when contentRegexes array is empty', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.', contentRegexes: [] }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      expect(capturedCommand()).not.toContain('--content-regex');
    });

    it('builds a command with all flags enabled', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [
          {
            package: 'full-pkg@^2.0.0',
            outputDir: './data',
            force: true,
            gitignore: false,
            silent: true,
            dryRun: true,
            upgrade: true,
            files: ['**/*.json', 'docs/**'],
            contentRegexes: ['schema', 'version'],
          },
        ],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      const cmd = capturedCommand();
      expect(cmd).toContain('--packages "full-pkg@^2.0.0"');
      expect(cmd).toContain('--output "./data"');
      expect(cmd).toContain(' --force');
      expect(cmd).toContain(' --no-gitignore');
      expect(cmd).toContain(' --silent');
      expect(cmd).toContain(' --dry-run');
      expect(cmd).toContain(' --upgrade');
      expect(cmd).toContain('--files "**/*.json,docs/**"');
      expect(cmd).toContain('--content-regex "schema,version"');
    });

    it('uses the resolved CLI path in the command', () => {
      setupPackageJson({
        name: 'irrelevant',
        npmdata: [{ package: 'my-pkg', outputDir: '.' }],
      });

      run(BIN_DIR, EXTRACT_ARGV);

      // The command must reference an absolute path to main.js and contain the extract sub-command.
      expect(capturedCommand()).toMatch(/node ".+main\.js"/);
      expect(capturedCommand()).toContain('extract');
    });
  });

  describe('parseTagsFromArgv', () => {
    it('returns an empty array when --tags is not present', () => {
      expect(parseTagsFromArgv(['node', 'script.js'])).toEqual([]);
    });

    it('returns a single tag when --tags has one value', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', 'prod'])).toEqual(['prod']);
    });

    it('splits comma-separated tags', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', 'prod,staging'])).toEqual([
        'prod',
        'staging',
      ]);
    });

    it('trims whitespace from tags', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', ' prod , staging '])).toEqual([
        'prod',
        'staging',
      ]);
    });

    it('ignores --tags when there is no following value', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags'])).toEqual([]);
    });

    it('filters out empty strings produced by trailing commas', () => {
      expect(parseTagsFromArgv(['node', 'script.js', '--tags', 'prod,'])).toEqual(['prod']);
    });
  });

  describe('filterEntriesByTags', () => {
    const entryA: NpmdataExtractEntry = { package: 'pkg-a', outputDir: './a', tags: ['prod'] };
    const entryB: NpmdataExtractEntry = {
      package: 'pkg-b',
      outputDir: './b',
      tags: ['staging', 'prod'],
    };
    const entryC: NpmdataExtractEntry = { package: 'pkg-c', outputDir: './c', tags: ['dev'] };
    const entryNoTags: NpmdataExtractEntry = { package: 'pkg-d', outputDir: './d' };

    it('returns all entries when requestedTags is empty', () => {
      expect(filterEntriesByTags([entryA, entryB, entryC, entryNoTags], [])).toEqual([
        entryA,
        entryB,
        entryC,
        entryNoTags,
      ]);
    });

    it('returns only entries matching the requested tag', () => {
      expect(filterEntriesByTags([entryA, entryB, entryC, entryNoTags], ['prod'])).toEqual([
        entryA,
        entryB,
      ]);
    });

    it('returns entries matching any of the requested tags', () => {
      expect(
        filterEntriesByTags([entryA, entryB, entryC, entryNoTags], ['dev', 'staging']),
      ).toEqual([entryB, entryC]);
    });

    it('excludes entries with no tags when a tag filter is active', () => {
      expect(filterEntriesByTags([entryNoTags], ['prod'])).toEqual([]);
    });

    it('returns an empty array when no entries match', () => {
      expect(filterEntriesByTags([entryA, entryC], ['staging'])).toEqual([]);
    });
  });

  describe('run – tags filtering', () => {
    it('runs all entries when --tags is not provided', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('runs only entries matching the requested tag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // 1 extract for pkg-a, 1 purge for excluded pkg-b
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('extract') && c.includes('pkg-a'))).toBe(true);
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-b'))).toBe(true);
    });

    it('runs entries matching any of the requested tags', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod,staging']);

      // 2 extracts (pkg-a, pkg-b) + 1 purge (excluded pkg-c)
      expect(mockExecSync).toHaveBeenCalledTimes(3);
      const cmds = capturedCommands();
      expect(cmds.filter((c) => c.includes('extract')).length).toBe(2);
      expect(cmds.filter((c) => c.includes('purge')).length).toBe(1);
    });

    it('runs no extract commands but purges all entries when no entry matches the requested tag', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['dev'] }],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // No extract, but purge is called for the excluded entry
      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(capturedCommand()).toContain('purge');
      expect(capturedCommand()).not.toContain('extract');
    });

    it('skips entries without tags from extract but purges them when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a' },
          { package: 'pkg-b', outputDir: './b', tags: ['prod'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // 1 extract (pkg-b) + 1 purge (untagged pkg-a)
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('extract') && c.includes('pkg-b'))).toBe(true);
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-a'))).toBe(true);
    });

    it('does not pass --tags to the extract command', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      expect(capturedCommand()).not.toContain('--tags');
    });
  });

  describe('run – purge excluded entries when tags filter is active', () => {
    it('purges excluded entries when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // One extract call for pkg-a, one purge call for pkg-b
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('extract') && c.includes('pkg-a'))).toBe(true);
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-b'))).toBe(true);
    });

    it('does not purge anything when no tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract']);

      // Both entries extracted, no purge
      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => !c.includes('purge'))).toBe(true);
    });

    it('purges all excluded entries when multiple are excluded', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging'] },
          { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      // 1 extract (pkg-a), 2 purges (pkg-b, pkg-c)
      expect(mockExecSync).toHaveBeenCalledTimes(3);
      const cmds = capturedCommands();
      expect(cmds.filter((c) => c.includes('extract')).length).toBe(1);
      expect(cmds.filter((c) => c.includes('purge')).length).toBe(2);
    });

    it('purges entries without tags when a tag filter is active', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-untagged', outputDir: './u' },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      const cmds = capturedCommands();
      expect(cmds.some((c) => c.includes('purge') && c.includes('pkg-untagged'))).toBe(true);
    });

    it('purges nothing (only extract) when all entries match the tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['prod', 'staging'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('extract'))).toBe(true);
    });

    it('runs only purge commands when no entries match the tag filter', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['staging'] },
          { package: 'pkg-b', outputDir: './b', tags: ['dev'] },
        ],
      });

      run(BIN_DIR, ['node', 'script.js', 'extract', '--tags', 'prod']);

      const cmds = capturedCommands();
      expect(cmds.every((c) => c.includes('purge'))).toBe(true);
    });
  });

  describe('buildPurgeCommand', () => {
    const CLI_PATH = '/path/to/main.js';

    it('builds a purge command with package name and output dir', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: './out' };
      const cmd = buildPurgeCommand(CLI_PATH, entry);
      expect(cmd).toContain('purge');
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).toContain('--output "./out"');
    });

    it('strips version specifier from the package name', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg@^2.0.0', outputDir: '.' };
      const cmd = buildPurgeCommand(CLI_PATH, entry);
      expect(cmd).toContain('--packages "my-pkg"');
      expect(cmd).not.toContain('2.0.0');
    });

    it('adds --silent when entry has silent: true', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.', silent: true };
      const cmd = buildPurgeCommand(CLI_PATH, entry);
      expect(cmd).toContain(' --silent');
    });

    it('adds --dry-run when entry has dryRun: true', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.', dryRun: true };
      const cmd = buildPurgeCommand(CLI_PATH, entry);
      expect(cmd).toContain(' --dry-run');
    });

    it('uses node and the provided CLI path', () => {
      const entry: NpmdataExtractEntry = { package: 'my-pkg', outputDir: '.' };
      const cmd = buildPurgeCommand(CLI_PATH, entry);
      expect(cmd).toMatch(/node ".+main\.js"/);
    });
  });

  describe('collectAllTags', () => {
    it('returns an empty array when no entry has tags', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a' },
        { package: 'pkg-b', outputDir: './b' },
      ];
      expect(collectAllTags(entries)).toEqual([]);
    });

    it('collects tags from a single entry', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['prod', 'staging'] },
      ];
      expect(collectAllTags(entries)).toEqual(['prod', 'staging']);
    });

    it('deduplicates tags across entries', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
        { package: 'pkg-b', outputDir: './b', tags: ['prod', 'staging'] },
        { package: 'pkg-c', outputDir: './c', tags: ['dev'] },
      ];
      expect(collectAllTags(entries)).toEqual(['dev', 'prod', 'staging']);
    });

    it('returns tags sorted alphabetically', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['zzz', 'aaa', 'mmm'] },
      ];
      expect(collectAllTags(entries)).toEqual(['aaa', 'mmm', 'zzz']);
    });

    it('ignores entries with undefined tags', () => {
      const entries: NpmdataExtractEntry[] = [
        { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
        { package: 'pkg-b', outputDir: './b' },
      ];
      expect(collectAllTags(entries)).toEqual(['prod']);
    });

    it('returns an empty array for an empty entries list', () => {
      expect(collectAllTags([])).toEqual([]);
    });
  });

  describe('printHelp', () => {
    it('includes the package name in the output', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg');
      writeSpy.mockRestore();
    });

    it('lists available tags in the output', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', ['dev', 'prod', 'staging']);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('dev, prod, staging');
      writeSpy.mockRestore();
    });

    it('shows a placeholder when no tags are available', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('(none defined in package.json)');
      writeSpy.mockRestore();
    });

    it('mentions --tags option', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('--tags');
      writeSpy.mockRestore();
    });

    it('mentions --help option', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('--help');
      writeSpy.mockRestore();
    });

    it('shows an extract-without-tags example using the package name', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', ['prod']);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg extract');
      expect(output).toContain('Extract files for all entries');
      writeSpy.mockRestore();
    });

    it('shows an extract-with-tags example using the first available tag', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', ['prod', 'staging']);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg extract --tags prod');
      expect(output).toContain('"prod"');
      writeSpy.mockRestore();
    });

    it('uses "my-tag" as placeholder tag in example when no tags are defined', () => {
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      printHelp('my-data-pkg', []);
      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-data-pkg extract --tags my-tag');
      writeSpy.mockRestore();
    });
  });

  describe('run – --help flag', () => {
    it('prints help and does not run any extractions when --help is present', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a', tags: ['prod'] }],
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('includes package name in help output', () => {
      setupPackageJson({ name: 'my-special-pkg' });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-special-pkg');
      writeSpy.mockRestore();
    });

    it('lists tags from npmdata entries in help output', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [
          { package: 'pkg-a', outputDir: './a', tags: ['prod'] },
          { package: 'pkg-b', outputDir: './b', tags: ['staging', 'prod'] },
        ],
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('prod');
      expect(output).toContain('staging');
      writeSpy.mockRestore();
    });

    it('shows placeholder when no tags are defined', () => {
      setupPackageJson({
        name: 'my-pkg',
        npmdata: [{ package: 'pkg-a', outputDir: './a' }],
      });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', '--help']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('(none defined in package.json)');
      writeSpy.mockRestore();
    });
  });

  describe('run – default help', () => {
    it('shows help and does not extract when no action is provided', () => {
      setupPackageJson({ name: 'my-pkg' });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js']);

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('shows help when invoked with only the node and script args (default argv)', () => {
      setupPackageJson({ name: 'my-pkg' });
      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js']);

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output).toContain('my-pkg');
      expect(output).toContain('extract');
      writeSpy.mockRestore();
    });
  });

  describe('run – unknown action', () => {
    it('prints an error and help without extracting for an unknown action', () => {
      setupPackageJson({ name: 'my-pkg' });
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'bogus']);

      expect(mockExecSync).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalled();
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    });

    it('includes the unknown action name in the error message', () => {
      setupPackageJson({ name: 'my-pkg' });
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      run(BIN_DIR, ['node', 'script.js', 'bogus']);

      const errOutput = stderrSpy.mock.calls[0][0] as string;
      expect(errOutput).toContain('bogus');
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    });
  });
});
