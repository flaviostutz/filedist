/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import {
  parseArgv,
  buildEntriesFromArgv,
  applyArgvOverrides,
  filterEntriesByPresets,
} from '../../package/argv';
import { printUsage } from '../usage';
import { actionExtract } from '../../package/action-extract';

/**
 * `extract` CLI command handler.
 * Parses argv, merges with config, calls actionExtract, prints summary.
 */
export async function runExtract(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('extract');
    return;
  }

  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // Build entries: --packages overrides config sets
  let entries = buildEntriesFromArgv(parsed);
  if (!entries) {
    if (!config || config.sets.length === 0) {
      console.error('Error: No packages specified. Use --packages or a config file with sets.');
      process.exitCode = 1;
      return;
    }
    entries = config.sets;
  }

  // Apply CLI overrides and preset filter
  const overridden = applyArgvOverrides(entries, parsed);
  const presets = parsed.presets ?? [];
  const filtered = filterEntriesByPresets(overridden, presets);

  if (filtered.length === 0) {
    console.log('No entries matched the specified presets.');
    return;
  }

  try {
    const result = await actionExtract({
      entries: filtered,
      config,
      cwd,
      onProgress: (event: import('../../types').ProgressEvent) => {
        if (filtered[0]?.silent) return;
        if (event.type === 'file-added') console.log(`  + ${event.file}`);
        else if (event.type === 'file-modified') console.log(`  ~ ${event.file}`);
        else if (event.type === 'file-deleted') console.log(`  - ${event.file}`);
      },
    });

    // Run postExtractScript if configured and not dry-run
    const isDryRun = filtered.some((e) => e.output.dryRun);
    if (!isDryRun && config?.postExtractScript) {
      const { execSync } = await import('node:child_process');
      const scriptCmd = `${config.postExtractScript} ${argv.join(' ')}`.trim();
      try {
        execSync(scriptCmd, { cwd, stdio: 'inherit', encoding: 'utf8' });
      } catch (error: unknown) {
        const e = error as { status?: number };
        process.exitCode = e.status ?? 1;
        return;
      }
    }

    console.log(
      `Extract complete: ${result.added} added, ${result.modified} modified, ` +
        `${result.deleted} deleted, ${result.skipped} skipped.`,
    );
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
