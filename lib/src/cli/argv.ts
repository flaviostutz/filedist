/* eslint-disable no-undefined */
import { FiledistConfig, FiledistExtractEntry, SelectorConfig, OutputConfig } from '../types';
import { filterEntriesByPresets } from '../utils';

export type FiledistCliConfig = FiledistConfig & {
  defaultPresets?: string[];
};

/**
 * Parsed CLI flags for all commands.
 * All flags are undefined when not supplied on the command line;
 * defaults are applied downstream in the library.
 */
export type ParsedArgv = {
  /** Positional package spec: filedist install <package_definition> */
  package?: string;
  output?: string;
  files?: string[];
  exclude?: string[];
  contentRegexes?: string[];
  all?: boolean;
  presets?: string[];
  configFile?: string;
  force?: boolean;
  mutable?: boolean;
  /** --nosync / --nosync=true|false */
  nosync?: boolean;
  /** --gitignore / --gitignore=true|false */
  gitignore?: boolean;
  /** --managed / --managed=true|false  (false ≡ unmanaged mode) */
  managed?: boolean;
  dryRun?: boolean;
  upgrade?: boolean;
  silent?: boolean;
  verbose?: boolean;
  /** --no-save: skip saving config to .filedistrc.yml */
  ignoreConfig?: boolean;
  /** --local-only: skip package installs/git clones; verify only against .filedist markers */
  localOnly?: boolean;
  /** --frozen-lockfile: use .filedist.lock exclusively; fail if lock file is missing */
  frozenLockfile?: boolean;
};

export function resolveEffectivePresets(
  parsed: ParsedArgv,
  config?: FiledistCliConfig | null,
): string[] {
  if (parsed.all === true) {
    return [];
  }

  return parsed.presets ?? config?.defaultPresets ?? [];
}

function buildSelectorFromArgv(parsed: ParsedArgv, presets: string[]): SelectorConfig {
  const selector: SelectorConfig = {};

  if (parsed.files) selector.files = parsed.files;
  if (parsed.exclude) selector.exclude = parsed.exclude;
  if (parsed.contentRegexes) selector.contentRegexes = parsed.contentRegexes;
  if (presets.length > 0) selector.presets = presets;
  if (parsed.upgrade !== undefined) selector.upgrade = parsed.upgrade;

  return selector;
}

function buildOutputFromArgv(parsed: ParsedArgv): OutputConfig {
  return {
    ...(parsed.output !== undefined ? { path: parsed.output } : {}),
    ...(parsed.force !== undefined ? { force: parsed.force } : {}),
    ...(parsed.mutable !== undefined ? { mutable: parsed.mutable } : {}),
    ...(parsed.nosync !== undefined ? { noSync: parsed.nosync } : {}),
    ...(parsed.gitignore !== undefined ? { gitignore: parsed.gitignore } : {}),
    ...(parsed.managed !== undefined ? { managed: parsed.managed } : {}),
    ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
  };
}

/**
 * Parse all supported CLI flags from an argv array.
 * Validates mutually exclusive combinations and throws on invalid input.
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const getBoolFlag = (flag: string): boolean | undefined => {
    for (const arg of argv) {
      if (arg === flag) return true;
      if (arg === `${flag}=true`) return true;
      if (arg === `${flag}=false`) return false;
    }

    return undefined;
  };
  const getValue = (flag: string, shortFlag?: string): string | undefined => {
    const idx = argv.findIndex((a) => a === flag || (shortFlag !== undefined && a === shortFlag));
    if (idx === -1 || idx + 1 >= argv.length) {
      return undefined;
    }
    return argv[idx + 1];
  };
  const getCommaSplit = (flag: string, shortFlag?: string): string[] | undefined => {
    const val = getValue(flag, shortFlag);

    if (val === undefined) {
      return undefined;
    }
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const force = getBoolFlag('--force');
  const mutable = getBoolFlag('--mutable');

  if (force === true && mutable === true) {
    throw new Error('--force and --mutable are mutually exclusive');
  }

  // Positional package arg: first element that does not start with '-' and is
  // not the value of a known flag-with-value (--output, --files, --exclude,
  // --content-regex, --presets, --config).
  const flagsWithValue = new Set([
    '--output',
    '-o',
    '--files',
    '--exclude',
    '--content-regex',
    '--presets',
    '--config',
  ]);
  let positionalPkg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (flagsWithValue.has(argv[i])) i++; // skip the value following the flag
    } else {
      positionalPkg = argv[i];
      break;
    }
  }
  const all = getBoolFlag('--all');
  const presets = getCommaSplit('--presets');

  if (all === true && presets && presets.length > 0) {
    throw new Error('--all and --presets are mutually exclusive');
  }

  const verboseFlag = getBoolFlag('--verbose');

  return {
    package: positionalPkg,
    output: getValue('--output', '-o'),
    files: getCommaSplit('--files'),
    exclude: getCommaSplit('--exclude'),
    contentRegexes: getCommaSplit('--content-regex'),
    all,
    presets,
    configFile: getValue('--config'),
    force,
    mutable,
    nosync: getBoolFlag('--nosync'),
    gitignore: getBoolFlag('--gitignore'),
    managed: getBoolFlag('--managed'),
    dryRun: getBoolFlag('--dry-run'),
    upgrade: getBoolFlag('--upgrade'),
    silent: getBoolFlag('--silent'),
    verbose: argv.includes('-v') ? true : verboseFlag,
    ignoreConfig: getBoolFlag('--no-save'),
    localOnly: getBoolFlag('--local-only'),
    frozenLockfile: getBoolFlag('--frozen-lockfile'),
  };
}

/**
 * Build a FiledistExtractEntry from the positional package arg + CLI flags.
 * Returns null if no positional package arg is present.
 */
export function buildEntriesFromArgv(
  parsed: ParsedArgv,
  presets: string[] = parsed.presets ?? [],
): FiledistExtractEntry[] | null {
  if (!parsed.package) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }

  // In positional-package mode there is no entry-level presets tag, so we place
  // --presets into selector.presets. filterEntriesByPresets checks both fields,
  // which keeps --presets filtering working in this mode.
  // selector.presets is also forwarded to the target package's nested set extraction.
  const selector = buildSelectorFromArgv(parsed, presets);
  const output = buildOutputFromArgv(parsed);

  return [
    {
      package: parsed.package,
      output,
      selector,
      ...(parsed.silent !== undefined ? { silent: parsed.silent } : {}),
      ...(parsed.verbose !== undefined ? { verbose: parsed.verbose } : {}),
    },
  ];
}

/**
 * Apply CLI overrides from ParsedArgv to each FiledistExtractEntry.
 * CLI flags always take precedence over config file values.
 */
export function applyArgvOverrides(
  entries: FiledistExtractEntry[],
  parsed: ParsedArgv,
): FiledistExtractEntry[] {
  return entries.map((entry) => {
    const updatedOutput: OutputConfig = {
      ...entry.output,

      ...(parsed.output !== undefined ? { path: parsed.output } : {}),
      ...(parsed.force !== undefined ? { force: parsed.force } : {}),
      ...(parsed.mutable !== undefined ? { mutable: parsed.mutable } : {}),
      ...(parsed.nosync !== undefined ? { noSync: parsed.nosync } : {}),
      ...(parsed.gitignore !== undefined ? { gitignore: parsed.gitignore } : {}),
      ...(parsed.managed !== undefined ? { managed: parsed.managed } : {}),
      ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
    };

    const updatedSelector: SelectorConfig = {
      ...entry.selector,
      ...(parsed.files ? { files: parsed.files } : {}),
      ...(parsed.exclude ? { exclude: parsed.exclude } : {}),
      ...(parsed.contentRegexes ? { contentRegexes: parsed.contentRegexes } : {}),
      ...(parsed.upgrade !== undefined ? { upgrade: parsed.upgrade } : {}),
    };

    return {
      ...entry,
      output: updatedOutput,
      selector: updatedSelector,
      ...(parsed.silent !== undefined ? { silent: parsed.silent } : {}),
      ...(parsed.verbose !== undefined ? { verbose: parsed.verbose } : {}),
    };
  });
}

/**
 * Build and preset-filter extract entries from parsed CLI args and/or config.
 * When a positional package arg is provided, one entry is built from CLI flags.
 * Otherwise, entries come from the config sets with CLI overrides applied.
 * Results are filtered by any requested --presets.
 * Throws if no packages are configured.
 */
export function resolveEntriesFromConfigAndArgs(
  config: FiledistConfig | null,
  argv: string[],
): FiledistExtractEntry[] {
  const parsed = parseArgv(argv);
  const effectivePresets = resolveEffectivePresets(parsed, config as FiledistCliConfig | null);

  let entries = buildEntriesFromArgv(parsed, effectivePresets);
  if (!entries) {
    if (!config || config.sets.length === 0) {
      throw new Error(
        `No packages specified. Use 'filedist install <package>' or a config file with sets.`,
      );
    }
    entries = applyArgvOverrides(config.sets, parsed);
  }

  // filter by presets
  const filtered = filterEntriesByPresets(entries, effectivePresets);
  return filtered;
}
