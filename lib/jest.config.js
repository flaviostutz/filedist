// eslint-disable-next-line import/no-commonjs, functional/immutable-data
module.exports = {
  testMatch: ['**/?(*.)+(spec|test).+(ts|tsx|js)'],
  transform: {
    '^.+\\.(tsx?|json?)$': [
      'esbuild-jest',
      {
        sourcemap: true, // correct line numbers in code coverage
      },
    ],
  },
  coverageReporters: ['text'],
  collectCoverage: true,
  collectCoverageFrom: [
    './src/**',
    '!**/__tests__/**',
    '!./src/main.ts',
    '!./src/runner.ts',
    '!./src/index.ts',
    '!./src/v2/index.ts',
    '!./src/v2/package/index.ts',
    '!./src/v2/fileset/index.ts',
    '!./src/v2/cli/commands/check.ts',
    '!./src/v2/cli/commands/extract.ts',
    '!./src/v2/cli/commands/init.ts',
    '!./src/v2/cli/commands/list.ts',
    '!./src/v2/cli/commands/purge.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 80,
    },
  },
};
