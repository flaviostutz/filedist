import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { FiledistExtractEntry, ManagedFileMetadata } from '../types';
import { shortenChecksum } from '../utils';

const LOCKFILE_VERSION = 1;

/**
 * Derive the lock file path from the config file path.
 * Strips the `.yml` suffix from the config file basename and appends `.lock`.
 *
 * Examples:
 *   `/project/.filedist.yml`  → `/project/.filedist.lock`
 *   `/project/myconfig.yml`   → `/project/myconfig.lock`
 */
export function getLockfilePath(configFilePath: string): string {
  const dir = path.dirname(configFilePath);
  const base = path.basename(configFilePath);
  const lockBase = base.endsWith('.yml') ? `${base.slice(0, -4)}.lock` : `${base}.lock`;
  return path.join(dir, lockBase);
}

export type LockfileData = {
  version: number;
  /** Maps package spec → resolved version/ref string. */
  packages: Record<string, string>;
  /**
   * Set definitions stored during install; used by check/purge/frozen-install
   * to operate without reading the user configuration file.
   */
  sets?: FiledistExtractEntry[];
  /** Maps output-dir key → pipe-delimited managed-file lines. */
  files?: Record<string, string[]>;
  /** SHA-256 checksum of packages + files + sets sections. Validated on every read. */
  checksum?: string;
};

/**
 * Compute a SHA-256 checksum over the packages, files, and sets sections of a
 * lockfile. The input is deterministic (keys sorted) so the result is stable
 * across writes.
 */
export function computeLockfileChecksum(
  data: Pick<LockfileData, 'packages' | 'files' | 'sets'>,
): string {
  const sortedPackages = Object.fromEntries(
    Object.entries(data.packages ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const sortedFiles: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(data.files ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    sortedFiles[k] = [...v].sort();
  }
  const payload = JSON.stringify({
    packages: sortedPackages,
    files: sortedFiles,
    sets: data.sets ?? [],
  });
  return shortenChecksum(crypto.createHash('sha256').update(payload).digest('hex'));
}

/**
 * Read a lock file from the given absolute path.
 * Returns undefined when the file does not exist.
 * Throws when the file exists but cannot be parsed or has a bad checksum.
 */
export function readLockfile(lockfilePath: string): LockfileData | undefined {
  const lockPath = lockfilePath;
  if (!fs.existsSync(lockPath)) {
    // eslint-disable-next-line no-undefined
    return undefined;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read lock file at ${lockPath}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    throw new Error(`Lock file at ${lockPath} contains invalid YAML.`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as LockfileData).version !== 'number' ||
    typeof (parsed as LockfileData).packages !== 'object'
  ) {
    throw new Error(`Lock file at ${lockPath} has an unexpected format.`);
  }
  const data = parsed as LockfileData;
  // Validate checksum when present.
  // eslint-disable-next-line no-undefined
  if (data.checksum !== undefined) {
    const expected = computeLockfileChecksum(data);
    if (data.checksum !== expected) {
      throw new Error(
        `Lock file at ${lockPath} is corrupted (checksum mismatch). ` +
          `Use --force to recreate it.`,
      );
    }
  }
  return data;
}

/**
 * Write a lock file to the given absolute path.
 */
export function writeLockfile(lockfilePath: string, data: LockfileData): void {
  const lockPath = lockfilePath;

  const payload: LockfileData = { ...data, version: LOCKFILE_VERSION };

  if (!payload.sets || payload.sets.length === 0) {
    delete payload.sets;
  }
  if (!payload.files || Object.keys(payload.files).length === 0) {
    delete payload.files;
  }
  // Compute and attach checksum (exclude any stale checksum before computing).
  delete payload.checksum;
  payload.checksum = computeLockfileChecksum(payload);

  const content = yaml.dump(payload, { lineWidth: -1, quotingType: "'" }) + '\n';
  fs.writeFileSync(lockPath, content, 'utf8');
}

/**
 * Read the set definitions stored in a lock file.
 * Returns undefined when the file does not exist or has no sets.
 */
export function readSetsFromLockfile(lockfilePath: string): FiledistExtractEntry[] | undefined {
  const lockData = readLockfile(lockfilePath);
  if (!lockData?.sets || lockData.sets.length === 0) {
    // eslint-disable-next-line no-undefined
    return undefined;
  }
  return lockData.sets;
}

/**
 * Build a LockfileData object from a map of spec → resolved version and source.
 */
export function buildLockfileData(
  resolvedPackages: Map<string, { source: 'npm' | 'git'; resolvedVersion: string }>,
): LockfileData {
  const packages: Record<string, string> = {};
  for (const [spec, info] of resolvedPackages) {
    packages[spec] = info.resolvedVersion;
  }
  return { version: LOCKFILE_VERSION, packages };
}

// ── Managed-files helpers ────────────────────────────────────────────────────

/**
 * Returns the key used in managed_files for a given output directory.
 * The key is relative to cwd, normalised to forward slashes.
 */
export function outputDirKey(cwd: string, outputDir: string): string {
  const rel = path.relative(cwd, outputDir);
  return rel.split(path.sep).join('/');
}

function parseManagedFileLine(line: string): ManagedFileMetadata {
  const fields = line.split('|');
  return {
    path: fields[0] ?? '',
    packageName: fields[1] ?? '',
    packageVersion: fields[2] ?? '',
    kind: fields[3] === 'symlink' ? 'symlink' : 'file',
    checksum: fields[4] ?? '',
    mutable: fields[5] === '1',
  };
}

function serializeManagedFileLine(e: ManagedFileMetadata): string {
  const kindField = e.kind === 'symlink' ? 'symlink' : 'file';
  const checksumField = e.checksum;
  const mutableField = e.mutable ? '1' : '0';
  return `${e.path}|${e.packageName}|${e.packageVersion}|${kindField}|${checksumField}|${mutableField}`;
}

/**
 * Read managed file entries for a specific output directory from a lock file.
 * Returns an empty array when the lock file or directory entry does not exist.
 */
export function readManagedFilesForDir(
  lockfilePath: string,
  cwd: string,
  outputDir: string,
): ManagedFileMetadata[] {
  const lockData = readLockfile(lockfilePath);

  if (!lockData?.files) return [];
  const key = outputDirKey(cwd, outputDir);

  const lines = lockData.files[key] ?? [];
  return lines.map((line) => parseManagedFileLine(line));
}

/**
 * Write managed file entries for a specific output directory into a lock file.
 * Reads the current lock file, updates the entry for outputDir, and writes it back.
 * When entries is empty the key is removed.
 */
export function writeManagedFilesForDir(
  lockfilePath: string,
  cwd: string,
  outputDir: string,
  entries: ManagedFileMetadata[],
): void {
  const lockData = readLockfile(lockfilePath) ?? { version: LOCKFILE_VERSION, packages: {} };
  const key = outputDirKey(cwd, outputDir);

  const managedFiles: Record<string, string[]> = lockData.files ?? {};
  if (entries.length === 0) {
    delete managedFiles[key];
  } else {
    managedFiles[key] = entries.map((e) => serializeManagedFileLine(e));
  }
  writeLockfile(lockfilePath, { ...lockData, files: managedFiles });
}
