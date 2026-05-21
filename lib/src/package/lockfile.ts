import fs from 'node:fs';
import path from 'node:path';

export const LOCKFILE_NAME = '.filedist.lock';
const LOCKFILE_VERSION = 1;

export type LockfilePackageEntry = {
  ref: string;
};

export type LockfileData = {
  lockfileVersion: number;
  packages: Record<string, LockfilePackageEntry>;
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

  const content = JSON.stringify({ ...data, lockfileVersion: LOCKFILE_VERSION }, void 0, 2) + '\n';
  fs.writeFileSync(lockPath, content, 'utf8');
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
