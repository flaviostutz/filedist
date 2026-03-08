/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv, applyArgvOverrides } from '../../package/argv';
import { printUsage } from '../usage';
import { actionCheck } from '../../package/action-check';

/**
 * `check` CLI command handler.
 */
export async function runCheck(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('check');
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

  if (!config || config.sets.length === 0) {
    console.error('Error: No config found and no --packages specified.');
    process.exitCode = 1;
    return;
  }

  const overridden = applyArgvOverrides(config.sets, parsed);

  try {
    const summary = await actionCheck({
      entries: overridden,
      config,
      cwd,
      skipUnmanaged: parsed.unmanaged,
    });

    const hasDrift =
      summary.missing.length > 0 || summary.modified.length > 0 || summary.extra.length > 0;

    if (hasDrift) {
      for (const f of summary.missing) console.log(`missing: ${f}`);
      for (const f of summary.modified) console.log(`modified: ${f}`);
      for (const f of summary.extra) console.log(`extra: ${f}`);
      process.exitCode = 1;
    } else {
      console.log('All managed files are in sync.');
    }
  } catch (error: unknown) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
