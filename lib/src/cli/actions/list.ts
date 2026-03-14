/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { actionList } from '../../package/action-list';

/**
 * `list` CLI action handler.
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

  const files = await actionList({
    outputDir: parsed.output ?? cwd,
    verbose: parsed.verbose,
  });

  if (files.length === 0) {
    console.log('No managed files found');
  } else {
    for (const f of files) {
      console.log(`${f.path}  ${f.packageName}@${f.packageVersion}`);
    }
  }
}
