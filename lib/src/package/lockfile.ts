import fs from 'node:fs';
import path from 'node:path';

import { FiledistExtractEntry, ManagedFileMetadata } from '../types';

export const LOCKFILE_NAME = '.filedist.lock';
const LOCKFILE_VERSION = 1;

export type LockfilePackageEntry = {
  ref: string;
};

export type LockfileData = {
  lockfileVersion: number;
  packages: Record<string, LockfilePackageEntry>;
  /**
   * Set definitions stored during install; used by check/purge/frozen-install
   * to operate without reading the user configuration file.
   */
  sets?: FiledistExtractEntry[];
  managed_files?: Record<string, string[]>;
};

/**
 * Read .filedist.lock from cwd.
 * Returns undefined when the file does not exist.
 * Throws when the file exists but cannot be parsed.
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
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Lock file at ${lockPath} contains invalid JSON.`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as LockfileData).lockfileVersion !== 'number' ||
    typeof (parsed as LockfileData).packages !== 'object'
  ) {
    throw new Error(`Lock file at ${lockPath} has an unexpected format.`);
  }
  return parsed as LockfileData;
}

/**
 * Write .filedist.lock to cwd.
 */
export function writeLockfile(cwd: string, data: LockfileData): void {
  const lockPath = path.join(cwd, LOCKFILE_NAME);

  const payload: LockfileData = { ...data, lockfileVersion: LOCKFILE_VERSION };

  if (!payload.sets || payload.sets.length === 0) {
    delete payload.sets;
  }
  if (!payload.managed_files || Object.keys(payload.managed_files).length === 0) {
    delete payload.managed_files;
  }
  const content = JSON.stringify(payload, void 0, 2) + '\n';
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
  const packages: Record<string, LockfilePackageEntry> = {};
  for (const [spec, info] of resolvedPackages) {
    packages[spec] = { ref: info.resolvedVersion };
  }
  return { lockfileVersion: LOCKFILE_VERSION, packages };
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

  if (!lockData?.managed_files) return [];
  const key = outputDirKey(cwd, outputDir);

  const lines = lockData.managed_files[key] ?? [];
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
  const lockData = readLockfile(cwd) ?? { lockfileVersion: LOCKFILE_VERSION, packages: {} };
  const key = outputDirKey(cwd, outputDir);

  const managedFiles: Record<string, string[]> = lockData.managed_files ?? {};
  if (entries.length === 0) {
    delete managedFiles[key];
  } else {
    managedFiles[key] = entries.map((e) => serializeManagedFileLine(e));
  }
  // eslint-disable-next-line camelcase
  writeLockfile(cwd, { ...lockData, managed_files: managedFiles });
}
