import { FiledistExtractEntry } from '../types';
import { filterEntriesByPresets } from '../utils';

import {
  parseArgv,
  buildEntriesFromArgv,
  applyArgvOverrides,
  resolveEntriesFromConfigAndArgs,
} from './argv';

describe('parseArgv', () => {
  it('parses --force flag', () => {
    expect(parseArgv(['--force']).force).toBe(true);
    expect(parseArgv(['--force=true']).force).toBe(true);
    expect(parseArgv(['--force=false']).force).toBe(false);
    expect(parseArgv([]).force).toBeUndefined();
  });

  it('parses --mutable flag', () => {
    expect(parseArgv(['--mutable']).mutable).toBe(true);
    expect(parseArgv(['--mutable=false']).mutable).toBe(false);
    expect(parseArgv([]).mutable).toBeUndefined();
  });

  it('parses --nosync flag', () => {
    expect(parseArgv(['--nosync']).nosync).toBe(true);
    expect(parseArgv(['--nosync=false']).nosync).toBe(false);
    expect(parseArgv([]).nosync).toBeUndefined();
  });

  it('throws when --force and --mutable are both set', () => {
    expect(() => parseArgv(['--force', '--mutable'])).toThrow(
      '--force and --mutable are mutually exclusive',
    );
  });

  it('parses positional package spec', () => {
    const result = parseArgv(['my-pkg@^1.0.0', '--output', './out']);
    expect(result.package).toBe('my-pkg@^1.0.0');
  });

  it('parses positional git package spec', () => {
    const result = parseArgv(['git:github.com/acme/repo.git@main']);
    expect(result.package).toBe('git:github.com/acme/repo.git@main');
  });

  it('returns undefined package when no positional arg is given', () => {
    expect(parseArgv(['--output', './out']).package).toBeUndefined();
    expect(parseArgv([]).package).toBeUndefined();
  });

  it('parses --output / -o', () => {
    expect(parseArgv(['--output', './out']).output).toBe('./out');
    expect(parseArgv(['-o', './out']).output).toBe('./out');
  });

  it('parses --files as comma-split', () => {
    expect(parseArgv(['--files', 'docs/**,*.md']).files).toEqual(['docs/**', '*.md']);
  });

  it('parses --content-regex as comma-split', () => {
    expect(parseArgv(['--content-regex', 'hello,world']).contentRegexes).toEqual([
      'hello',
      'world',
    ]);
  });

  it('parses --presets as comma-split', () => {
    expect(parseArgv(['--presets', 'docs,api']).presets).toEqual(['docs', 'api']);
  });

  it('parses --all flag', () => {
    expect(parseArgv(['--all']).all).toBe(true);
    expect(parseArgv(['--all=true']).all).toBe(true);
    expect(parseArgv(['--all=false']).all).toBe(false);
    expect(parseArgv([]).all).toBeUndefined();
  });

  it('throws when --all and --presets are both set', () => {
    expect(() => parseArgv(['--all', '--presets', 'docs'])).toThrow(
      '--all and --presets are mutually exclusive',
    );
  });

  it('parses boolean flags', () => {
    const parsed = parseArgv([
      '--dry-run',
      '--nosync',
      '--gitignore=false',
      '--managed=false',
      '--upgrade',
      '--silent',
      '--verbose',
    ]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.nosync).toBe(true);
    expect(parsed.gitignore).toBe(false);
    expect(parsed.managed).toBe(false);
    expect(parsed.upgrade).toBe(true);
    expect(parsed.silent).toBe(true);
    expect(parsed.verbose).toBe(true);
  });

  it('parses --gitignore and --managed flags with values', () => {
    expect(parseArgv(['--gitignore']).gitignore).toBe(true);
    expect(parseArgv(['--gitignore=true']).gitignore).toBe(true);
    expect(parseArgv(['--gitignore=false']).gitignore).toBe(false);
    expect(parseArgv([]).gitignore).toBeUndefined();
    expect(parseArgv(['--managed']).managed).toBe(true);
    expect(parseArgv(['--managed=true']).managed).toBe(true);
    expect(parseArgv(['--managed=false']).managed).toBe(false);
    expect(parseArgv([]).managed).toBeUndefined();
  });

  it('parses -v as verbose', () => {
    expect(parseArgv(['-v']).verbose).toBe(true);
  });

  it('parses --config flag', () => {
    expect(parseArgv(['--config', 'my-config.json']).configFile).toBe('my-config.json');
    expect(parseArgv(['--config', '/absolute/path/config.json']).configFile).toBe(
      '/absolute/path/config.json',
    );
    expect(parseArgv([]).configFile).toBeUndefined();
  });

  it('returns undefined for all boolean flags when none are set', () => {
    const parsed = parseArgv([]);
    expect(parsed.force).toBeUndefined();
    expect(parsed.mutable).toBeUndefined();
    expect(parsed.dryRun).toBeUndefined();
    expect(parsed.nosync).toBeUndefined();
    expect(parsed.verbose).toBeUndefined();
    expect(parsed.gitignore).toBeUndefined();
    expect(parsed.managed).toBeUndefined();
    expect(parsed.upgrade).toBeUndefined();
    expect(parsed.silent).toBeUndefined();
  });
});

describe('buildEntriesFromArgv', () => {
  it('returns null when no positional package arg is given', () => {
    expect(buildEntriesFromArgv(parseArgv([]))).toBeNull();
    expect(buildEntriesFromArgv(parseArgv(['--output', './out']))).toBeNull();
  });

  it('builds one entry from positional package arg', () => {
    const parsed = parseArgv(['my-pkg@1.0.0', '--output', './out']);
    const entries = buildEntriesFromArgv(parsed);
    expect(entries).toHaveLength(1);
    expect(entries![0].package).toBe('my-pkg@1.0.0');
    expect(entries![0].output!.path).toBe('./out');
  });

  it('builds entry with a prefixed git package', () => {
    const parsed = parseArgv(['git:github.com/acme/repo.git@main']);
    const entries = buildEntriesFromArgv(parsed);
    expect(entries![0].package).toBe('git:github.com/acme/repo.git@main');
  });

  it('leaves output path undefined when --output is not set', () => {
    const parsed = parseArgv(['my-pkg']);
    const entries = buildEntriesFromArgv(parsed);
    expect(entries![0].output!.path).toBeUndefined();
  });
});

describe('filterEntriesByPresets', () => {
  const entries: FiledistExtractEntry[] = [
    { package: 'pkg-a', output: { path: '.' }, selector: { presets: ['docs'] } },
    { package: 'pkg-b', output: { path: '.' }, selector: { presets: ['api', 'docs'] } },
    { package: 'pkg-c', output: { path: '.' }, selector: {} },
  ];

  it('returns all entries when no presets requested', () => {
    expect(filterEntriesByPresets(entries, [])).toHaveLength(3);
  });

  it('filters to only matching preset entries', () => {
    const result = filterEntriesByPresets(entries, ['api']);
    expect(result).toHaveLength(1);
    expect(result[0].package).toBe('pkg-b');
  });

  it('includes entries matching any of the requested presets', () => {
    const result = filterEntriesByPresets(entries, ['docs']);
    expect(result).toHaveLength(2);
  });
});

describe('applyArgvOverrides', () => {
  const baseEntry: FiledistExtractEntry = {
    package: 'test-pkg',
    output: { path: './current', force: false },
    selector: { files: ['*.ts'] },
  };

  it('overrides output path when --output is set', () => {
    const parsed = parseArgv(['test-pkg', '--output', './new-path']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.path).toBe('./new-path');
  });

  it('does not override output path when --output is not set', () => {
    const parsed = parseArgv(['test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.path).toBe('./current');
  });

  it('applies --force override', () => {
    const parsed = parseArgv(['test-pkg', '--force']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.force).toBe(true);
  });

  it('applies --mutable override', () => {
    const parsed = parseArgv(['test-pkg', '--mutable']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.mutable).toBe(true);
  });

  it('applies --nosync override', () => {
    const parsed = parseArgv(['test-pkg', '--nosync']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.noSync).toBe(true);
  });

  it('preserves config mutable=true when --mutable is not set on CLI', () => {
    const entryWithMutable: FiledistExtractEntry = {
      package: 'test-pkg',
      output: { path: './current', mutable: true },
      selector: {},
    };
    const parsed = parseArgv(['test-pkg']); // no --mutable
    const result = applyArgvOverrides([entryWithMutable], parsed);
    expect(result[0].output!.mutable).toBe(true);
  });

  it('applies --gitignore=false override', () => {
    const parsed = parseArgv(['test-pkg', '--gitignore=false']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.gitignore).toBe(false);
  });

  it('applies --gitignore=true override', () => {
    const parsed = parseArgv(['test-pkg', '--gitignore=true']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.gitignore).toBe(true);
  });

  it('applies --managed=false override', () => {
    const parsed = parseArgv(['test-pkg', '--managed=false']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.managed).toBe(false);
  });

  it('applies --managed=true override', () => {
    const parsed = parseArgv(['test-pkg', '--managed=true']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.managed).toBe(true);
  });

  it('applies --dry-run override', () => {
    const parsed = parseArgv(['test-pkg', '--dry-run']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.dryRun).toBe(true);
  });

  it('applies --files override to selector', () => {
    const parsed = parseArgv(['test-pkg', '--files', 'docs/**']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].selector?.files).toEqual(['docs/**']);
  });

  it('applies --content-regex override to selector', () => {
    const parsed = parseArgv(['test-pkg', '--content-regex', 'hello']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].selector?.contentRegexes).toEqual(['hello']);
  });

  it('applies --upgrade override to selector', () => {
    const parsed = parseArgv(['test-pkg', '--upgrade']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].selector?.upgrade).toBe(true);
  });

  it('applies --silent override', () => {
    const parsed = parseArgv(['test-pkg', '--silent']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].silent).toBe(true);
  });

  it('applies --verbose override', () => {
    const parsed = parseArgv(['test-pkg', '--verbose']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].verbose).toBe(true);
  });

  it('does not rewrite package specs when applying overrides', () => {
    const entry: FiledistExtractEntry = {
      package: 'git:github.com/acme/repo.git@main',
      output: { path: './current' },
      selector: {},
    };
    const parsed = parseArgv(['test-pkg']);
    const result = applyArgvOverrides([entry], parsed);
    expect(result[0].package).toBe('git:github.com/acme/repo.git@main');
  });
});

describe('resolveEntriesFromConfigAndArgs', () => {
  it('uses config defaultPresets when --presets is not provided', () => {
    const config = {
      defaultPresets: ['docs'],
      sets: [
        { package: 'pkg-docs', output: { path: '.' }, presets: ['docs'] },
        { package: 'pkg-api', output: { path: '.' }, presets: ['api'] },
      ],
    };

    const entries = resolveEntriesFromConfigAndArgs(config, []);

    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('pkg-docs');
  });

  it('prefers explicit --presets over config defaultPresets', () => {
    const config = {
      defaultPresets: ['docs'],
      sets: [
        { package: 'pkg-docs', output: { path: '.' }, presets: ['docs'] },
        { package: 'pkg-api', output: { path: '.' }, presets: ['api'] },
      ],
    };

    const entries = resolveEntriesFromConfigAndArgs(config, ['--presets', 'api']);

    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('pkg-api');
  });

  it('applies config defaultPresets to ad-hoc positional package mode', () => {
    const config = {
      defaultPresets: ['docs'],
      sets: [],
    };

    const entries = resolveEntriesFromConfigAndArgs(config, ['pkg-docs']);

    expect(entries).toHaveLength(1);
    expect(entries[0].selector?.presets).toEqual(['docs']);
  });

  it('uses --all to ignore config defaultPresets', () => {
    const config = {
      defaultPresets: ['docs'],
      sets: [
        { package: 'pkg-docs', output: { path: '.' }, presets: ['docs'] },
        { package: 'pkg-api', output: { path: '.' }, presets: ['api'] },
      ],
    };

    const entries = resolveEntriesFromConfigAndArgs(config, ['--all']);

    expect(entries).toHaveLength(2);
  });

  it('does not forward selector.presets in ad-hoc positional package mode when --all is used', () => {
    const config = {
      defaultPresets: ['docs'],
      sets: [],
    };

    const entries = resolveEntriesFromConfigAndArgs(config, ['pkg-docs', '--all']);

    expect(entries).toHaveLength(1);
    expect(entries[0].selector?.presets).toBeUndefined();
  });
});
