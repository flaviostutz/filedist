/* eslint-disable no-restricted-syntax */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { NpmdataExtractEntry } from './types';
import { parsePackageSpec } from './utils';

type PackageJson = {
  name: string;
  npmdata?: NpmdataExtractEntry[];
};

/**
 * Extract just the package name (without version specifier) from a package spec string.
 * Delegates to the shared parsePackageSpec utility.
 */
function parseEntryPackageName(spec: string): { name: string } {
  const { name } = parsePackageSpec(spec);
  return { name };
}

function buildExtractCommand(cliPath: string, entry: NpmdataExtractEntry): string {
  const outputFlag = ` --output "${entry.outputDir}"`;
  const forceFlag = entry.force ? ' --force' : '';
  const gitignoreFlag = entry.gitignore === false ? ' --no-gitignore' : '';
  const unmanagedFlag = entry.unmanaged ? ' --unmanaged' : '';
  const silentFlag = entry.silent ? ' --silent' : '';
  const dryRunFlag = entry.dryRun ? ' --dry-run' : '';
  const upgradeFlag = entry.upgrade ? ' --upgrade' : '';
  const filesFlag =
    entry.files && entry.files.length > 0 ? ` --files "${entry.files.join(',')}"` : '';
  const contentRegexFlag =
    entry.contentRegexes && entry.contentRegexes.length > 0
      ? ` --content-regex "${entry.contentRegexes.join(',')}"`
      : '';
  return `node "${cliPath}" extract --packages "${entry.package}"${outputFlag}${forceFlag}${gitignoreFlag}${unmanagedFlag}${silentFlag}${dryRunFlag}${upgradeFlag}${filesFlag}${contentRegexFlag}`;
}

/**
 * Build a CLI command string that purges (removes) all managed files for the entry's package
 * from its output directory. No package installation is required.
 */
export function buildPurgeCommand(cliPath: string, entry: NpmdataExtractEntry): string {
  const { name } = parseEntryPackageName(entry.package);
  const outputFlag = ` --output "${entry.outputDir}"`;
  // Propagate silent/dry-run settings from the entry if present.
  const silentFlag = entry.silent ? ' --silent' : '';
  const dryRunFlag = entry.dryRun ? ' --dry-run' : '';
  return `node "${cliPath}" purge --packages "${name}"${outputFlag}${silentFlag}${dryRunFlag}`;
}

/**
 * Collects all unique tags that appear across the given npmdata entries, sorted alphabetically.
 */
export function collectAllTags(entries: NpmdataExtractEntry[]): string[] {
  const tagSet = new Set<string>();
  for (const entry of entries) {
    if (entry.tags) {
      for (const tag of entry.tags) {
        tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
}

/**
 * Prints a help message to stdout, listing the extract action, all options, and available tags.
 */
export function printHelp(packageName: string, availableTags: string[]): void {
  const tagsLine =
    availableTags.length > 0 ? availableTags.join(', ') : '(none defined in package.json)';
  const exampleTag = availableTags.length > 0 ? availableTags[0] : 'my-tag';
  process.stdout.write(
    [
      `Usage: ${packageName} <action> [options]`,
      '',
      'Actions:',
      '  extract  Extract files from the source package(s) defined in package.json',
      '',
      'Options:',
      '  --help              Show this help message',
      '  --tags <tag1,tag2>  Limit extraction to entries whose tags overlap (comma-separated)',
      '',
      `Available tags: ${tagsLine}`,
      '',
      'Examples:',
      `  ${packageName} extract`,
      '    Extract files for all entries defined in package.json',
      '',
      `  ${packageName} extract --tags ${exampleTag}`,
      `    Extract files only for entries tagged "${exampleTag}"`,
      '',
    ].join('\n'),
  );
}

/**
 * Parses --tags from an argv array and returns the list of requested tags (split by comma).
 * Returns an empty array when --tags is not present.
 */
export function parseTagsFromArgv(argv: string[]): string[] {
  const idx = argv.indexOf('--tags');
  if (idx === -1 || idx + 1 >= argv.length) {
    return [];
  }
  return argv[idx + 1]
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Filter entries by requested tags. When no tags are requested all entries pass through.
 * When tags are requested only entries that share at least one tag with the requested list
 * are included.
 */
export function filterEntriesByTags(
  entries: NpmdataExtractEntry[],
  requestedTags: string[],
): NpmdataExtractEntry[] {
  if (requestedTags.length === 0) {
    return entries;
  }
  return entries.filter((entry) => entry.tags && entry.tags.some((t) => requestedTags.includes(t)));
}

/**
 * Runs extraction for each entry defined in the publishable package's package.json "npmdata" array.
 * Invokes the npmdata CLI once per entry so that all CLI output and error handling is preserved.
 * Called from the minimal generated bin script with its own __dirname as binDir.
 *
 * Pass --tags <tag1,tag2> to limit extraction to entries whose tags overlap with the given list.
 */
export function run(binDir: string, argv: string[] = process.argv): void {
  const pkgJsonPath = path.join(binDir, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as PackageJson;

  const allEntries: NpmdataExtractEntry[] =
    pkg.npmdata && pkg.npmdata.length > 0 ? pkg.npmdata : [{ package: pkg.name, outputDir: '.' }];

  const userArgs = argv.slice(2);

  if (userArgs.length === 0 || userArgs.includes('--help')) {
    printHelp(pkg.name, collectAllTags(allEntries));
    return;
  }

  const action = userArgs[0];

  if (action !== 'extract') {
    process.stderr.write(`Error: unknown action '${action}'. Use 'extract'.\n\n`);
    printHelp(pkg.name, collectAllTags(allEntries));
    return;
  }

  const requestedTags = parseTagsFromArgv(argv);
  const entries = filterEntriesByTags(allEntries, requestedTags);
  const excludedEntries =
    requestedTags.length > 0 ? allEntries.filter((e) => !entries.includes(e)) : [];

  const cliPath = require.resolve('npmdata/dist/main.js', { paths: [binDir] });

  for (const entry of entries) {
    const command = buildExtractCommand(cliPath, entry);
    execSync(command, { stdio: 'inherit' });
  }

  // When a tag filter is active, purge managed files from excluded entries so that
  // the output directory contains only files from the currently active tag group.
  for (const entry of excludedEntries) {
    const command = buildPurgeCommand(cliPath, entry);
    execSync(command, { stdio: 'inherit' });
  }
}
