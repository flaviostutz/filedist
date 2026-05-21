import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { FiledistExtractEntry, ManagedFileMetadata } from '../types';
import { shortenChecksum } from '../utils';

export const LOCKFILE_NAME = '.filedist.lock';
const LOCKFILE_VERSION = 1;

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
 * Read .filedist.lock from cwd.
 * Returns undefined when the file does not exist.
 * Throws when the file exists but cannot be parsed or has a bad checksum.
 */
export function readLockfile(cwd: string): LockfileData | undefined {
  const lockPath = path.join(cwd, LOCKFILE_NAME);
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
 * Write .filedist.lock to cwd.
 */
export function writeLockfile(cwd: string, data: LockfileData): void {
  const lockPath = path.join(cwd, LOCKFILE_NAME);

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
 * Read the set definitions stored in .filedist.lock.
 * Returns undefined when the file does not exist or has no sets.
 */
export function readSetsFromLockfile(cwd: string): FiledistExtractEntry[] | undefined {
  const lockData = readLockfile(cwd);
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
 * Read managed file entries for a specific output directory from .filedist.lock.
 * Returns an empty array when the lock file or directory entry does not exist.
 */
export function readManagedFilesForDir(cwd: string, outputDir: string): ManagedFileMetadata[] {
  const lockData = readLockfile(cwd);

  if (!lockData?.files) return [];
  const key = outputDirKey(cwd, outputDir);

  const lines = lockData.files[key] ?? [];
  return lines.map((line) => parseManagedFileLine(line));
}

/**
 * Write managed file entries for a specific output directory into .filedist.lock.
 * Reads the current lock file, updates the entry for outputDir, and writes it back.
 * When entries is empty the key is removed.
 */
export function writeManagedFilesForDir(
  cwd: string,
  outputDir: string,
  entries: ManagedFileMetadata[],
): void {
  const lockData = readLockfile(cwd) ?? { version: LOCKFILE_VERSION, packages: {} };
  const key = outputDirKey(cwd, outputDir);

  const managedFiles: Record<string, string[]> = lockData.files ?? {};
  if (entries.length === 0) {
    delete managedFiles[key];
  } else {
    managedFiles[key] = entries.map((e) => serializeManagedFileLine(e));
  }
  writeLockfile(cwd, { ...lockData, files: managedFiles });
}
