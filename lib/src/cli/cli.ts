/* eslint-disable no-console */
import path from 'node:path';

import {
  loadDefaultConfig,
  loadFiledistConfigFile,
  upsertFiledistConfigEntries,
} from '../package/config';
import { getLockfilePath } from '../package/lockfile';
import { FiledistConfig } from '../types';

import { printUsage, printVersion } from './usage';
import { runInstall } from './actions/install';
import { runCheck } from './actions/check';
import { runList } from './actions/list';
import { runRemove } from './actions/remove';
import { runInit } from './actions/init';
import { runPresets } from './actions/presets';
import { runUpdate } from './actions/update';
import { parseArgv, buildEntriesFromArgv } from './argv';

const KNOWN_COMMANDS = new Set(['install', 'check', 'list', 'remove', 'init', 'presets', 'update']);

/**
 * Top-level CLI router.
 * Detects command from argv, loads config, and dispatches to appropriate handler.
 *
 * @param argv      - Process argument vector (argv[0] = node, argv[1] = script).
 * @param cwd       - Working directory for output path resolution (defaults to process.cwd()).
 * @param configSearchCwd - Directory to search for filedist config (defaults to cwd).
 */
export async function cli(argv: string[], cwd?: string, configSearchCwd?: string): Promise<number> {
  const args = argv.slice(2); // strip node + script

  // Handle global --help with no command
  if (args.includes('--help') && args.length === 1) {
    printUsage();
    return 0;
  }

  // Handle global --version
  if (args.includes('--version')) {
    printVersion();
    return 0;
  }

  // Detect action
  let action: string;
  let cmdArgs: string[];

  const firstArg = args[0];
  if (!firstArg || firstArg.startsWith('-')) {
    // No command given, or first arg is a flag: default to install
    action = 'install';
    cmdArgs = args;
  } else if (KNOWN_COMMANDS.has(firstArg)) {
    action = firstArg;
    cmdArgs = args.slice(1);
  } else {
    // Unknown bare word — will be caught below as unknown command
    action = firstArg;
    cmdArgs = args.slice(1);
  }

  const effectiveCwd = cwd ?? process.cwd();
  const effectiveConfigSearchCwd = configSearchCwd ?? effectiveCwd;

  const ignoreConfig = args.includes('--no-save') || args.includes('--no-save=true');
  const packageSpecified = action === 'install' && !ignoreConfig && !!parseArgv(cmdArgs).package;

  try {
    if (!KNOWN_COMMANDS.has(action)) {
      throw new Error(
        `Unknown command: "${action}". Run 'filedist --help' for available commands.`,
      );
    }
    const { config, configFilePath, lockfilePath, installArgv } = await resolveConfig(
      args,
      cmdArgs,
      effectiveCwd,
      effectiveConfigSearchCwd,
      ignoreConfig,
      packageSpecified,
    );

    await dispatch(
      action,
      config,
      installArgv ?? cmdArgs,
      effectiveCwd,
      configFilePath,
      lockfilePath,
    );
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function resolveConfig(
  args: string[],
  cmdArgs: string[],
  effectiveCwd: string,
  effectiveConfigSearchCwd: string,
  ignoreConfig: boolean,
  packageSpecified: boolean,
): Promise<{
  config: FiledistConfig | null;
  configFilePath: string;
  lockfilePath: string;
  installArgv?: string[];
}> {
  const configFlagIdx = args.indexOf('--config');
  const configFileArg =
    configFlagIdx !== -1 && configFlagIdx + 1 < args.length
      ? args[configFlagIdx + 1]
      : // eslint-disable-next-line no-undefined
        undefined;

  const configFilePath = configFileArg
    ? path.resolve(effectiveCwd, configFileArg)
    : path.join(effectiveConfigSearchCwd, '.filedist.yml');
  const lockfilePath = getLockfilePath(configFilePath);

  let config: FiledistConfig | null;
  if (configFileArg) {
    config = loadFiledistConfigFile(configFilePath);
  } else if (ignoreConfig) {
    // eslint-disable-next-line unicorn/no-null
    config = null;
  } else {
    config = loadDefaultConfig(effectiveConfigSearchCwd);
  }

  // When a positional package arg is specified, persist the entry to the config file,
  // then reload the full config and run install from the config file (ignoring the positional arg).
  if (packageSpecified && !ignoreConfig) {
    const parsed = parseArgv(cmdArgs);
    const entries = buildEntriesFromArgv(parsed);
    if (entries && entries.length > 0) {
      if (parsed.verbose) {
        console.log(`[verbose] Auto-saving packages to config file: ${configFilePath}`);
      }
      // Strip transient CLI-only flags before persisting to config:
      //   output.force    — one-time overwrite override; persisting would permanently force-overwrite files
      //   output.dryRun   — preview mode; persisting would silently skip all writes on future installs
      //   selector.upgrade — one-time upgrade request; persisting would upgrade on every install
      const entriesToSave = entries.map((entry) => {
        let { output, selector } = entry;
        if (output) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { force: _f, dryRun: _d, ...persistableOutput } = output;
          output = persistableOutput;
        }
        if (selector) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { upgrade: _u, ...persistableSelector } = selector;
          selector = persistableSelector;
        }
        return { ...entry, output, selector };
      });
      await upsertFiledistConfigEntries(effectiveCwd, configFilePath, entriesToSave);
      // Reload config from the now-updated file so install sees all sets (not just the new one).
      const reloadedConfig = loadFiledistConfigFile(configFilePath);
      // Strip package-specific flags — install will be driven entirely by the config file.
      const installArgv = stripPackageFlags(cmdArgs);
      return { config: reloadedConfig, configFilePath, lockfilePath, installArgv };
    }
  }

  return { config, configFilePath, lockfilePath };
}

/**
 * Remove the positional package arg and per-set flags from an argv array.
 * After the entry is saved to the config file, install should run from
 * the full config, so these per-invocation overrides must not be forwarded.
 *
 * Removed: positional package arg (first non-flag element), --output / -o, --files, --exclude, --content-regex
 * (each flag together with its following value argument).
 */
function stripPackageFlags(argv: string[]): string[] {
  const flagsWithValue = new Set(['--output', '-o', '--files', '--exclude', '--content-regex']);
  const result: string[] = [];
  let positionalStripped = false;
  let i = 0;
  while (i < argv.length) {
    if (flagsWithValue.has(argv[i])) {
      i += 2; // skip flag + value
    } else if (!positionalStripped && !argv[i].startsWith('-')) {
      // Strip the first positional (package spec)
      positionalStripped = true;
      i++;
    } else {
      result.push(argv[i]);
      i++;
    }
  }
  return result;
}

async function dispatch(
  action: string,
  config: FiledistConfig | null,
  cmdArgs: string[],
  cwd: string,
  configFilePath: string,
  lockfilePath: string,
): Promise<void> {
  switch (action) {
    case 'install':
      await runInstall(config, cmdArgs, cwd, lockfilePath);
      break;
    case 'check':
      await runCheck(cmdArgs, cwd, lockfilePath);
      break;
    case 'list':
      await runList(config, cmdArgs, cwd, lockfilePath);
      break;
    case 'remove':
      await runRemove(cmdArgs, cwd, lockfilePath, configFilePath);
      break;
    case 'update':
      await runUpdate(config, cmdArgs, cwd, lockfilePath);
      break;
    case 'init':
      await runInit(config, cmdArgs, cwd);
      break;
    case 'presets':
      await runPresets(config, cmdArgs);
      break;
    default:
      throw new Error(`Unknown command: ${action}`);
  }
}

export function setupUncaughtExceptionHandler(): void {
  if (!process.argv.includes('--verbose')) {
    process.on('uncaughtException', (err) => {
      const errs = `${err}`;
      let i = errs.indexOf('\n');
      if (i === -1) i = errs.length;
      console.log(errs.slice(0, Math.max(0, i)));
      process.exit(3);
    });
  }
}
