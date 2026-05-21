import fs from 'node:fs';
import path from 'node:path';

import { cosmiconfig } from 'cosmiconfig';
import yaml from 'js-yaml';

import { FiledistConfig, FiledistExtractEntry } from '../types';

type RawFiledistConfig = FiledistConfig & {
  postExtractCmd?: unknown;
  postExtractScript?: unknown;
};

const POST_EXTRACT_CMD_EXAMPLE = '["node", "scripts/post-extract.js"]';

const CONFIG_BASENAMES = [
  '.filedistrc',
  '.filedistrc.json',
  '.filedistrc.yaml',
  '.filedistrc.yml',
  'filedist.config.js',
  'filedist.config.cjs',
  'package.json',
] as const;

function validateFiledistConfig(
  cfg: RawFiledistConfig | null | undefined,
  sourceLabel: string,
): FiledistConfig | null {
  if (!cfg || !Array.isArray(cfg.sets)) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }

  // eslint-disable-next-line no-undefined
  if (cfg.postExtractScript !== undefined) {
    throw new Error(
      `Invalid filedist config at ${sourceLabel}: "postExtractScript" was renamed to ` +
        `"postExtractCmd". Use "postExtractCmd": ${POST_EXTRACT_CMD_EXAMPLE}.`,
    );
  }

  if (
    // eslint-disable-next-line no-undefined
    cfg.postExtractCmd !== undefined &&
    (!Array.isArray(cfg.postExtractCmd) ||
      cfg.postExtractCmd.some((part) => typeof part !== 'string'))
  ) {
    throw new Error(
      `Invalid filedist config at ${sourceLabel}: "postExtractCmd" must be an array of strings, ` +
        `for example ${POST_EXTRACT_CMD_EXAMPLE}. Shell strings like ` +
        `"node scripts/post-extract.js" are not supported.`,
    );
  }

  return cfg as FiledistConfig;
}

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
  return validateFiledistConfig(result.config as RawFiledistConfig, result.filepath);
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
  return validateFiledistConfig(result.config as RawFiledistConfig, result.filepath);
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

    const cfg = validateFiledistConfig(result.config as RawFiledistConfig, result.filepath);
    if (cfg) {
      return cfg;
    }
  }

  // eslint-disable-next-line unicorn/no-null
  return null;
}

const RC_FILENAME = '.filedistrc.yml';
const LOCAL_RC_FILENAME = '.filedistrc.local.yml';

/**
 * Load a filedist configuration from `.filedistrc.local.yml` in the given directory.
 * Returns the config when found, or null when the file does not exist or is empty.
 * The local config file is intentionally not searched in parent directories.
 */
export async function loadFiledistLocalConfig(directory: string): Promise<FiledistConfig | null> {
  const filePath = path.join(directory, LOCAL_RC_FILENAME);
  const explorer = cosmiconfig('filedist');
  let result;
  try {
    result = await explorer.load(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // eslint-disable-next-line unicorn/no-null
      return null;
    }
    throw error;
  }
  if (!result || result.isEmpty) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  return validateFiledistConfig(result.config as RawFiledistConfig, result.filepath);
}

/**
 * Upsert entries into a filedist YAML config file.
 * - Uses the path provided (from --config) or defaults to `.filedistrc.yml` in `directory`.
 * - Reads the existing file (or starts with an empty sets array).
 * - For each provided entry, replaces an existing entry with the same `package`
 *   value, or appends it when no match is found.
 * - Writes the merged result back as YAML.
 */
export async function upsertFiledistConfigEntries(
  directory: string,
  addEntries: FiledistExtractEntry[],
  configFilePath?: string,
): Promise<void> {
  const filePath = configFilePath ?? path.join(directory, RC_FILENAME);

  // Read and parse existing config, or start fresh
  let existing: { sets: FiledistExtractEntry[] } = { sets: [] };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) as { sets?: FiledistExtractEntry[] } | null;
    if (parsed && Array.isArray(parsed.sets)) {
      existing = { sets: parsed.sets };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // Upsert each entry by package name
  let changed = false;
  for (const addEntry of addEntries) {
    const idx = existing.sets.findIndex((e) => e.package === addEntry.package);
    // Build a minimal entry: omit output and selector when they are empty objects
    const entryToSave: FiledistExtractEntry = { package: addEntry.package };
    if (addEntry.selector && Object.keys(addEntry.selector).length > 0) {
      entryToSave.selector = addEntry.selector;
    }
    if (addEntry.output && Object.keys(addEntry.output).length > 0) {
      entryToSave.output = addEntry.output;
    }
    if (idx !== -1) {
      // Only replace when the entry content differs
      if (JSON.stringify(existing.sets[idx]) !== JSON.stringify(entryToSave)) {
        existing.sets[idx] = entryToSave;
        changed = true;
      }
    } else {
      existing.sets.push(entryToSave);
      changed = true;
    }
  }

  if (!changed) return;
  fs.writeFileSync(filePath, yaml.dump(existing, { indent: 2 }), 'utf8');
}

/**
 * Strip the version/ref from a package spec string, leaving only the package name.
 *
 * Examples:
 *   "my-pkg@^1.2.3"                      → "my-pkg"
 *   "@scope/pkg@1.0.0"                   → "@scope/pkg"
 *   "git:github.com/org/repo.git@main"   → "git:github.com/org/repo.git"
 *   "my-pkg"                             → "my-pkg"
 */
export function packageNameWithoutRef(spec: string): string {
  if (!spec) return spec;
  if (spec.startsWith('git:')) {
    // git:url@ref — strip trailing @ref
    const atIdx = spec.lastIndexOf('@');
    return atIdx > 4 ? spec.slice(0, atIdx) : spec;
  }
  if (spec.startsWith('@')) {
    // @scope/name@version — find the @ that comes after the slash
    const slashIdx = spec.indexOf('/');
    if (slashIdx !== -1) {
      const atIdx = spec.indexOf('@', slashIdx);
      return atIdx !== -1 ? spec.slice(0, atIdx) : spec;
    }
  }
  // unscoped npm: name@version → name
  const atIdx = spec.indexOf('@');
  return atIdx !== -1 ? spec.slice(0, atIdx) : spec;
}

/**
 * Remove entries from the filedist YAML config file that match the given package name.
 *
 * - `packageSpec` is matched against each entry's `package` field after stripping
 *   the version/ref from both sides, so "xdrs-core@1.0.0" and "xdrs-core" both
 *   match entries whose package field starts with "xdrs-core".
 * - When `outputPath` is supplied, only entries whose `output.path` equals
 *   `outputPath` are removed (allows targeting a specific entry when the same
 *   package is installed to multiple output directories).
 * - Returns the number of entries removed.  Zero means the config was unchanged.
 * - When `configFilePath` is not supplied, defaults to `.filedistrc.yml` in `directory`.
 * - Throws if the config file exists but cannot be parsed.
 */
export function removeFiledistConfigEntries(
  directory: string,
  packageSpec: string,
  outputPath?: string,
  configFilePath?: string,
): number {
  const filePath = configFilePath ?? path.join(directory, RC_FILENAME);

  let existing: { sets: FiledistExtractEntry[] } = { sets: [] };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) as { sets?: FiledistExtractEntry[] } | null;
    if (parsed && Array.isArray(parsed.sets)) {
      existing = { sets: parsed.sets };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  const targetName = packageNameWithoutRef(packageSpec);

  const before = existing.sets.length;
  existing.sets = existing.sets.filter((entry) => {
    if (!entry.package) return true; // self-package entries are never removed
    const entryName = packageNameWithoutRef(entry.package);
    if (entryName !== targetName) return true; // different package — keep
    // eslint-disable-next-line no-undefined
    if (outputPath !== undefined && entry.output?.path !== outputPath) return true; // output filter
    return false; // matches — remove
  });

  const removed = before - existing.sets.length;
  if (removed === 0) return 0;

  fs.writeFileSync(filePath, yaml.dump(existing, { indent: 2 }), 'utf8');
  return removed;
}
