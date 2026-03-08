/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv } from '../../package/argv';
import { printUsage } from '../usage';
import { actionList } from '../../package/action-list';

/**
 * `list` CLI command handler.
 * Note: list always ignores --presets.
 */
export async function runList(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('list');
    return;
  }

  const parsed = parseArgv(argv);

  const entries = config?.sets ?? [];

  try {
    const files = await actionList({
      entries,
      config,
      cwd,
      output: parsed.output,
    });

    if (files.length === 0) {
      if (parsed.verbose) console.log('No managed files found.');
    } else {
      for (const f of files) {
        console.log(`${f.path}  ${f.packageName}@${f.packageVersion}`);
      }
    }
    // list always exits 0
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
