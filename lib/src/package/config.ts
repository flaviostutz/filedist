import { cosmiconfig } from 'cosmiconfig';

import { FiledistConfig } from '../types';

const CONFIG_BASENAMES = [
  '.filedistrc',
  '.filedistrc.json',
  '.filedistrc.yaml',
  '.filedistrc.yml',
  'filedist.config.js',
  'filedist.config.cjs',
  'package.json',
] as const;

/**
 * Search for a filedist configuration using cosmiconfig, starting from the given cwd.
 * Looks for (in priority order):
 *   - .filedistrc (JSON or YAML)
 *   - .filedistrc.json / .filedistrc.yaml / .filedistrc.js
 *   - filedist.config.js
 *   - "filedist" key in package.json
 *
 * Returns the FiledistConfig when found, or null when no configuration is present.
 */
export async function searchAndLoadFiledistConfig(cwd: string): Promise<FiledistConfig | null> {
  const explorer = cosmiconfig('filedist');
  const result = await explorer.search(cwd);
  if (!result || result.isEmpty) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  const cfg = result.config as FiledistConfig;
  if (!cfg || !Array.isArray(cfg.sets)) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  return cfg;
}

/**
 * Load a filedist configuration from an explicit file path using cosmiconfig.
 * Supports JSON, YAML, and JS config files.
 *
 * Returns the FiledistConfig when found, or null when the file is empty or invalid.
 */
export async function loadFiledistConfigFile(filePath: string): Promise<FiledistConfig | null> {
  const explorer = cosmiconfig('filedist');
  const result = await explorer.load(filePath);
  if (!result || result.isEmpty) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  const cfg = result.config as FiledistConfig;
  if (!cfg || !Array.isArray(cfg.sets)) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  return cfg;
}

/**
 * Load filedist config only from the given directory, without searching parent folders.
 */
export async function loadFiledistConfigFromDirectory(
  directory: string,
): Promise<FiledistConfig | null> {
  const explorer = cosmiconfig('filedist');

  for (const basename of CONFIG_BASENAMES) {
    let result;
    try {
      result = await explorer.load(`${directory}/${basename}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!result || result.isEmpty) continue;

    const cfg = result.config as FiledistConfig;
    if (cfg && Array.isArray(cfg.sets)) {
      return cfg;
    }
  }

  // eslint-disable-next-line unicorn/no-null
  return null;
}
