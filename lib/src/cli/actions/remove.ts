/* eslint-disable no-console */
import path from 'node:path';

import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionRemove } from '../../package/action-remove';

/**
 * `remove` CLI action handler.
 *
 * Requires either a package name (positional argument) or the --all flag.
 *
 * When --all is given, removes every set entry from the config file and runs
 * install with zero entries so all managed files are deleted and the lockfile
 * is cleared.
 *
 * When a package name is given, removes matching entries from the config file
 * (optionally filtered by --output, --presets), then runs a full install with
 * the remaining entries so orphaned files are deleted and the lockfile is updated.
 * Fails if no matching entry is found.
 *
 * Usage:
 *   filedist remove <package-name> [--output <path>] [--presets <tags>] [--dry-run] [--config <file>]
 *   filedist remove --all [--dry-run]
 */
export async function runRemove(
  argv: string[],
  cwd: string,
  lockfilePath: string,
  configFilePath: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('remove');
    return;
  }

  const parsed = parseArgv(argv);

  // Extract positional package name — first arg that is not a flag or flag value.
  const packageSpec = extractPackageSpec(argv) ?? parsed.package;

  if (!packageSpec && !parsed.all) {
    console.error(
      'filedist remove: requires a <package> argument or the --all flag.\n' +
        'Usage:\n' +
        '  filedist remove <package> [--output <path>] [--presets <tags>]\n' +
        '  filedist remove --all',
    );
    process.exitCode = 1;
    return;
  }

  // Resolve config file path: --config flag takes precedence, then auto-discovered path
  const resolvedConfigFilePath = parsed.configFile
    ? path.resolve(cwd, parsed.configFile)
    : configFilePath;

  if (parsed.all && !packageSpec) {
    const summary = await actionRemove({
      all: true,
      cwd,
      lockfilePath,
      configFilePath: resolvedConfigFilePath,
      dryRun: parsed.dryRun,
      verbose: parsed.verbose,
      onProgress: (event) => {
        if (parsed.silent) return;
        if (event.type === 'file-deleted') console.log(`  - ${formatProgressFile(event)}`);
      },
    });
    console.log(
      `Remove complete: ${summary.removedEntries} config entries removed, ` +
        `${summary.install.added} added, ${summary.install.modified} modified, ` +
        `${summary.install.deleted} deleted.`,
    );
    return;
  }

  const summary = await actionRemove({
    cwd,
    packageSpec,
    outputPath: parsed.output,
    presets: parsed.presets,
    lockfilePath,
    configFilePath: resolvedConfigFilePath,
    dryRun: parsed.dryRun,
    verbose: parsed.verbose,
    onProgress: (event: import('../../types').ProgressEvent) => {
      if (parsed.silent) return;
      if (event.type === 'file-added') console.log(`  + ${formatProgressFile(event)}`);
      else if (event.type === 'file-modified') console.log(`  ~ ${formatProgressFile(event)}`);
      else if (event.type === 'file-deleted') console.log(`  - ${formatProgressFile(event)}`);
    },
  });

  console.log(
    `Remove complete: ${summary.removedEntries} config entries removed, ` +
      `${summary.install.added} added, ${summary.install.modified} modified, ` +
      `${summary.install.deleted} deleted.`,
  );
}

/**
 * Extract the first positional argument from an argv array, skipping flags and
 * their values.
 *
 * Flags that consume the next token (known value flags) are handled so their
 * values are not mistakenly treated as the package name.
 */
function extractPackageSpec(argv: string[]): string | undefined {
  const valueFlags = new Set([
    '--output',
    '-o',
    '--files',
    '--exclude',
    '--content-regex',
    '--presets',
    '--config',
    '--packages',
  ]);
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (valueFlags.has(arg)) {
      i += 2; // skip flag and its value
      continue;
    }
    if (arg.startsWith('-')) {
      i += 1; // skip boolean flag
      continue;
    }
    return arg; // first non-flag positional argument
  }
  // eslint-disable-next-line no-undefined
  return undefined;
}
