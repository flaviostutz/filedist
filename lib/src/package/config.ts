import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { FiledistConfig, FiledistExtractEntry } from '../types';

type RawFiledistConfig = FiledistConfig & {
  postExtractCmd?: unknown;
  postExtractScript?: unknown;
};

const POST_EXTRACT_CMD_EXAMPLE = '["node", "scripts/post-extract.js"]';

/** Default bootstrap config filename. */
export const DEFAULT_CONFIG_FILENAME = '.filedist.yml';

/** Represents the structure of a .filedist.yml or .filedist-package.yml file. */
export type FiledistConfigFile = {
  version: number;
  sets: FiledistExtractEntry[];
};

/** Package config filename used by data packages to define their own sets. */
export const PACKAGE_CONFIG_FILENAME = '.filedist-package.yml';

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

function loadYamlConfig(filePath: string): FiledistConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // eslint-disable-next-line unicorn/no-null
      return null;
    }
    throw error;
  }
  const parsed = yaml.load(raw) as RawFiledistConfig | null;
  if (!parsed) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  return validateFiledistConfig(parsed, filePath);
}

/**
 * Load the default filedist bootstrap config (.filedist.yml) from the given directory.
 * Returns the FiledistConfig when found, or null when absent or empty.
 */
export function loadDefaultConfig(cwd: string): FiledistConfig | null {
  return loadYamlConfig(path.join(cwd, DEFAULT_CONFIG_FILENAME));
}

/**
 * Load a filedist bootstrap config from an explicit YAML file path.
 * Returns the FiledistConfig when found, or null when the file is empty or absent.
 */
export function loadFiledistConfigFile(filePath: string): FiledistConfig | null {
  return loadYamlConfig(filePath);
}

/**
 * Load a filedist package config (.filedist-package.yml) from the given directory.
 * Data packages place this file in their root to define their sets, selectors, and presets.
 * Returns the FiledistConfig when found, or null when absent or empty.
 */
export function loadPackageConfig(directory: string): FiledistConfig | null {
  return loadYamlConfig(path.join(directory, PACKAGE_CONFIG_FILENAME));
}

const RC_FILENAME = DEFAULT_CONFIG_FILENAME;

/**
 * Upsert entries into a filedist YAML config file.
 * - Uses the path provided (from --config) or defaults to `.filedist.yml` in `directory`.
 * - Reads the existing file (or starts with an empty sets array).
 * - For each provided entry, replaces an existing entry with the same `package`
 *   value, or appends it when no match is found.
 * - Writes the merged result back as YAML.
 */
/**
 * Upserts a single entry into the sets array. Returns true if changed.
 */
function upsertSingleEntry(sets: FiledistExtractEntry[], addEntry: FiledistExtractEntry): boolean {
  if (!addEntry.package) return false;
  const baseName = packageNameWithoutRef(addEntry.package);

  // Build a minimal entry: omit output and selector when they are empty objects
  const entryToSave: FiledistExtractEntry = { package: addEntry.package };
  if (addEntry.selector && Object.keys(addEntry.selector).length > 0) {
    entryToSave.selector = addEntry.selector;
  }
  if (addEntry.output && Object.keys(addEntry.output).length > 0) {
    entryToSave.output = addEntry.output;
  }

  // Collect indices of all entries whose base name matches (regardless of version)
  const matchingIndices = sets.reduce<number[]>((acc, e, i) => {
    if (e.package && packageNameWithoutRef(e.package) === baseName) acc.push(i);
    return acc;
  }, []);

  if (matchingIndices.length > 0) {
    const firstIdx = matchingIndices[0];
    // Short-circuit when there is exactly one match and it is already identical
    if (
      matchingIndices.length === 1 &&
      JSON.stringify(sets[firstIdx]) === JSON.stringify(entryToSave)
    ) {
      return false;
    }
    // Remove all matching entries in reverse order (preserves unaffected indices)
    for (let i = matchingIndices.length - 1; i >= 0; i--) {
      sets.splice(matchingIndices[i], 1);
    }
    // Re-insert the single updated entry at the position of the first removed entry
    sets.splice(firstIdx, 0, entryToSave);
    return true;
  }
  sets.push(entryToSave);
  return true;
}

export async function upsertFiledistConfigEntries(
  directory: string,
  configFilePath: string,
  addEntries: FiledistExtractEntry[],
): Promise<void> {
  const filePath = configFilePath;

  // Read and parse existing config, or start fresh
  let existing: FiledistConfigFile = { version: 1, sets: [] };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) as FiledistConfigFile;
    if (parsed?.sets) {
      existing = { version: parsed.version, sets: parsed.sets };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // Upsert each entry by base package name (ignoring version/ref).
  // All existing entries that share the same base name are removed and replaced
  // with a single new entry so that stale version selectors do not accumulate.
  let changed = false;
  for (const addEntry of addEntries) {
    if (upsertSingleEntry(existing.sets, addEntry)) changed = true;
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
 * - When `configFilePath` is not supplied, defaults to `.filedist.yml` in `directory`.
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
