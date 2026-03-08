#!/usr/bin/env node
/* eslint-disable unicorn/prefer-top-level-await */
import { cli } from './cli/cli';

cli(process.argv)
  // eslint-disable-next-line promise/prefer-await-to-callbacks
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error((error as Error).message);
    process.exitCode = 1;
  });
