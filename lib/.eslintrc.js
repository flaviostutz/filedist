// eslint-disable-next-line import/no-commonjs
module.exports = {
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  extends: '@stutzlab/eslint-config',
  rules: {
    'import/group-exports': 'off',
    'fp/no-class': 'off',
    'functional/immutable-data': 'off',
    'no-continue': 'off',
    'functional/no-let': 'off',
    'no-restricted-syntax': 'off',
    'functional/no-try-statements': 'off',
    'no-undefined': 'off',
  },
};
