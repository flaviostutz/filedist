// ESLint 9 flat config format
import baseConfig from '@stutzlab/eslint-config';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        project: [ './tsconfig.json' ],
        tsconfigRootDir: process.cwd(),
      },
    },
  },
];

