/* eslint-disable no-console */
import fs from 'node:fs';

import yaml from 'js-yaml';

import { FiledistExtractEntry, ProgressEvent } from '../types';

import { actionInstall, InstallResult } from './action-install';
import { packageNameWithoutRef } from './config';

export type RemoveOptions = {
  /**
   * Working directory; used to discover config file and resolve output paths.
   */
  cwd: string;
  /**
   * When true, removes all set entries. Mutually exclusive with packageSpec.
   */
  all?: boolean;
  /**
   * Package spec to remove. Version/ref is ignored during matching, so both
   * "xdrs-core" and "xdrs-core@1.0.0" match an entry whose package field
   * starts with "xdrs-core". Required when all is not true.
   */
  packageSpec?: string;
  /**
   * Optional: restrict removal to entries whose output.path equals this value.
   * When omitted, all entries for the package are removed.
   */
  outputPath?: string;
  /**
   * Optional: restrict removal to entries that contain ALL of these preset tags.
   */
  presets?: string[];
  /**
   * Explicit path to the config file. When omitted, the config is auto-discovered
   * via cosmiconfig (same as the `install` command).
   */
  configFilePath: string;
  lockfilePath: string;
  dryRun?: boolean;
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
};

export type RemoveSummary = {
  /** Number of config entries that were removed (or would be removed in dry-run). */
  removedEntries: number;
  /** Result from the subsequent install run that cleared the output directories. */
  install: InstallResult;
  /** True when the lock file was deleted (only possible on --all with full cleanup). */
  lockfileDeleted?: boolean;
  /** True when the config file was deleted (only possible on --all with full cleanup). */
  configFileDeleted?: boolean;
};

/**
 * Split config sets into the entries to remove and the entries to keep.
 */
function partitionSets(
  sets: FiledistExtractEntry[],
  targetName: string,
  outputPath?: string,
  presets?: string[],
): { toRemove: FiledistExtractEntry[]; toKeep: FiledistExtractEntry[] } {
  const toRemove: FiledistExtractEntry[] = [];
  const toKeep: FiledistExtractEntry[] = [];
  for (const e of sets) {
    if (!e.package) {
      toKeep.push(e);
      continue;
    }
    const match = packageNameWithoutRef(e.package) === targetName;
    // eslint-disable-next-line no-undefined
    const outputMatch = outputPath === undefined || e.output?.path === outputPath;
    // eslint-disable-next-line no-undefined
    const presetsMatch = presets === undefined || presets.every((p) => e.presets?.includes(p));
    if (match && outputMatch && presetsMatch) {
      toRemove.push(e);
    } else {
      toKeep.push(e);
    }
  }
  return { toRemove, toKeep };
}

/**
 * Read and parse sets from a YAML config file. Returns [] when file is missing or empty.
 */
function readConfigSets(filePath: string): FiledistExtractEntry[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) as { sets?: FiledistExtractEntry[] } | null;
    return parsed?.sets ?? [];
  } catch {
    return [];
  }
}

/**
 * Remove matching config entries and run a full install with the remaining entries
 * so that the lockfile is updated and removed files are deleted from output directories.
 *
 * Steps:
 *  1. Discover the config file path (unless `configFilePath` is supplied). Throws when
 *     no config file is found — the config file is required for this command.
 *  2. Partition the config sets: when `all=true`, all entries are removed; otherwise
 *     entries matching `packageSpec` (plus optional `outputPath` / `presets` filters)
 *     are removed. Throws when no matching entries are found.
 *  3. Rewrite the config file on disk with only the `toKeep` entries.
 *  4. Call `actionInstall` with the remaining entries (`frozenLockfile: false`)
 *     so the lockfile is updated and files for removed entries are deleted from disk.
 *
 * This has the same effect as manually deleting the matching sets from the config
 * file and running `filedist install`.
 */
// eslint-disable-next-line complexity
export async function actionRemove(options: RemoveOptions): Promise<RemoveSummary> {
  const {
    cwd,
    packageSpec,
    all = false,
    outputPath,
    presets,
    dryRun = false,
    verbose = false,
    onProgress,
  } = options;

  // ── Resolve config file path ──────────────────────────────────────────────
  const { configFilePath } = options;
  const currentSets = readConfigSets(configFilePath);

  // ── Determine which entries to remove and which to keep ───────────────────
  let toRemove: FiledistExtractEntry[];
  let toKeep: FiledistExtractEntry[];

  if (all) {
    toRemove = currentSets.slice();
    toKeep = [];
    if (verbose) {
      console.log(
        `[verbose] actionRemove: removing all ${toRemove.length} config entries` +
          (configFilePath ? ` from ${configFilePath}` : ''),
      );
    }
  } else {
    if (!packageSpec) {
      throw new Error('actionRemove: packageSpec is required when all is not true');
    }
    const targetName = packageNameWithoutRef(packageSpec);
    if (verbose) {
      console.log(
        `[verbose] actionRemove: removing entries for "${targetName}"` +
          (outputPath ? ` (output: ${outputPath})` : '') +
          (presets ? ` (presets: ${presets.join(',')})` : '') +
          (configFilePath ? ` from ${configFilePath}` : ' (no config file found)'),
      );
    }
    ({ toRemove, toKeep } = partitionSets(currentSets, targetName, outputPath, presets));
    if (toRemove.length === 0) {
      throw new Error(
        `No entries found for "${packageSpec}"` +
          (outputPath ? ` with output "${outputPath}"` : '') +
          (presets ? ` and presets "${presets.join(',')}"` : '') +
          '. Nothing removed.',
      );
    }
  }

  const removedEntries = toRemove.length;

  if (verbose && removedEntries > 0) {
    console.log(
      `[verbose] actionRemove: ${dryRun ? 'would remove' : 'removing'} ${removedEntries} config entries`,
    );
  }

  // ── Rewrite config file with remaining entries ────────────────────────────
  if (!dryRun && removedEntries > 0) {
    let existingConfig: Record<string, unknown> = {};
    try {
      const raw = fs.readFileSync(configFilePath, 'utf8');
      existingConfig = (yaml.load(raw) as Record<string, unknown> | null) ?? {};
    } catch {
      // no-op: file may not exist when using lockfile-only mode
    }
    existingConfig.sets = toKeep;
    const isJson = configFilePath.endsWith('.json');

    const content = isJson
      ? // eslint-disable-next-line unicorn/no-null
        JSON.stringify(existingConfig, null, 2) + '\n'
      : yaml.dump(existingConfig, { indent: 2 });
    fs.writeFileSync(configFilePath, content, 'utf8');
  }

  // ── Run install with remaining entries to update lockfile ─────────────────
  if (verbose) {
    console.log(`[verbose] actionRemove: running install with ${toKeep.length} remaining entries`);
  }

  const { lockfilePath } = options;
  const install = await actionInstall({
    entries: toKeep,
    cwd,
    lockfilePath,
    dryRun,
    verbose,
    frozenLockfile: false,
    onProgress,
  });

  // When --all is used and all files were successfully removed, delete the lock
  // file and config file since they would be empty/useless.
  let lockfileDeleted = false;
  let configFileDeleted = false;
  if (all && !dryRun && install.added === 0 && install.modified === 0) {
    try {
      if (fs.existsSync(lockfilePath)) {
        fs.unlinkSync(lockfilePath);
        lockfileDeleted = true;
        if (verbose) {
          console.log(`[verbose] actionRemove: deleted lock file ${lockfilePath}`);
        }
      }
    } catch {
      // Ignore lock file deletion errors
    }
    try {
      if (fs.existsSync(configFilePath)) {
        fs.unlinkSync(configFilePath);
        configFileDeleted = true;
        if (verbose) {
          console.log(`[verbose] actionRemove: deleted config file ${configFilePath}`);
        }
      }
    } catch {
      // Ignore config file deletion errors
    }
  }

  return { removedEntries, install, lockfileDeleted, configFileDeleted };
}
