/**
 * Name of the npmdata marker file that tracks managed files.
 */
export const MARKER_FILE = '.npmdata';

/**
 * Default filename patterns applied when no `files` glob patterns are specified in SelectorConfig.
 * Excludes common package metadata files that are not meant to be extracted by consumers.
 */
export const DEFAULT_FILENAME_PATTERNS = [
  '**',
  '!package.json',
  '!bin/**',
  '!README.md',
  '!node_modules/**',
];

export const GITIGNORE_FILE = '.gitignore';
export const GITIGNORE_START = '# npmdata:start';
export const GITIGNORE_END = '# npmdata:end';
