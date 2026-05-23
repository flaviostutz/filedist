/* eslint-disable no-console */
import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { actionCheck } from '../../package/action-check';

/**
 * `check` CLI action handler.
 *
 * Always operates in frozen-lockfile mode: reads set definitions and pinned
 * package versions from .filedist.lock. Fails if no lock file is found.
 * The user configuration file is not used.
 */
export async function runCheck(argv: string[], cwd: string, lockfilePath: string): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('check');
    return;
  }

  const parsed = parseArgv(argv);

  const summary = await actionCheck({
    entries: [],
    cwd,
    verbose: parsed.verbose,
    lockfilePath,
    localOnly: parsed.localOnly,
    frozenLockfile: true,
  });

  const hasDrift =
    summary.missing.length > 0 || summary.conflict.length > 0 || summary.extra.length > 0;

  if (hasDrift) {
    for (const f of summary.missing) console.log(`missing: ${f}`);
    for (const f of summary.conflict) console.log(`conflict: ${f}`);
    for (const f of summary.extra) console.log(`extra: ${f}`);
    throw new Error('Check failed: some managed files are out of sync');
  } else {
    console.log('All managed files are in sync');
  }
}
