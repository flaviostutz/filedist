/* eslint-disable no-console */
import { loadNpmdataConfig } from './config';
import { printUsage, printVersion } from './usage';
import { runExtract } from './commands/extract';
import { runCheck } from './commands/check';
import { runList } from './commands/list';
import { runPurge } from './commands/purge';
import { runInit } from './commands/init';

const KNOWN_COMMANDS = new Set(['extract', 'check', 'list', 'purge', 'init']);

/**
 * Top-level CLI router.
 * Detects command from argv, loads config, and dispatches to appropriate handler.
 */
export async function cli(argv: string[]): Promise<void> {
  const args = argv.slice(2); // strip node + script

  // Handle global --help with no command
  if (args.includes('--help') && args.length === 1) {
    printUsage();
    return;
  }

  // Handle global --version
  if (args.includes('--version')) {
    printVersion();
    return;
  }

  // Detect command
  let command: string;
  let cmdArgs: string[];

  const firstArg = args[0];
  if (firstArg && KNOWN_COMMANDS.has(firstArg)) {
    command = firstArg;
    cmdArgs = args.slice(1);
  } else {
    // Default to extract
    command = 'extract';
    cmdArgs = args;
  }

  // Load config from cwd
  const cwd = process.cwd();
  const config = await loadNpmdataConfig(cwd);

  switch (command) {
    case 'extract':
      await runExtract(config, cmdArgs, cwd);
      break;
    case 'check':
      await runCheck(config, cmdArgs, cwd);
      break;
    case 'list':
      await runList(config, cmdArgs, cwd);
      break;
    case 'purge':
      await runPurge(config, cmdArgs, cwd);
      break;
    case 'init':
      await runInit(config, cmdArgs, cwd);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exitCode = 1;
  }
}
