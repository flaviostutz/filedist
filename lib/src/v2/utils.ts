/* eslint-disable functional/no-try-statements */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

import { PackageConfig } from './types';

/**
 * Parse a package spec like "my-pkg@^1.2.3" or "@scope/pkg@2.x" into name and version.
 * The version separator is the LAST "@" so that scoped packages ("@scope/name") are handled.
 */
export function parsePackageSpec(spec: string): PackageConfig {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx > 0) {
    // eslint-disable-next-line no-undefined
    return { name: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) || undefined };
  }
  // eslint-disable-next-line no-undefined
  return { name: spec, version: undefined };
}

/**
 * Compute the SHA-256 hash of a file.
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Compute the SHA-256 hash of an in-memory buffer or string.
 * Used to hash content that has been transformed in memory before comparison.
 */
export function hashBuffer(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Synchronous file hash (SHA-256).
 */
export function hashFileSync(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Detect whether a file is binary by scanning it for null bytes.
 * Reads up to the first 8 KB only.
 */
export function isBinaryFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytesRead).includes(0x00);
  } catch {
    return false;
  }
}

/**
 * Detect package manager by inspecting lock files in the given directory.
 * Falls back to npm if no lock file is found.
 */
export function detectPackageManager(cwd?: string): 'pnpm' | 'npm' {
  const dir = cwd ?? process.cwd();
  try {
    const lockFiles = fs.readdirSync(dir);
    if (lockFiles.includes('pnpm-lock.yaml')) return 'pnpm';
    if (lockFiles.includes('package-lock.json')) return 'npm';
  } catch {
    // fall through
  }

  // Check npm_config_user_agent environment variable
  // eslint-disable-next-line no-process-env
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.includes('pnpm')) return 'pnpm';

  return 'npm';
}

/**
 * Install a package using the detected package manager.
 * Returns the installed package path under node_modules.
 */
export function installPackage(
  name: string,
  version: string | undefined,
  upgrade: boolean,
  cwd?: string,
): string {
  const workDir = cwd ?? process.cwd();
  const pm = detectPackageManager(workDir);
  const spec = version ? `${name}@${version}` : `${name}@latest`;

  // Check if already installed with a satisfying version (skip install if not upgrading)
  if (!upgrade) {
    const installedPath = path.join(workDir, 'node_modules', name, 'package.json');
    if (fs.existsSync(installedPath)) {
      return path.dirname(installedPath);
    }
  }

  const cmd = pm === 'pnpm' ? `pnpm add ${spec}` : `npm install ${spec}`;
  try {
    execSync(cmd, { cwd: workDir, stdio: 'pipe', encoding: 'utf8' });
  } catch (error: unknown) {
    const e = error as { stderr?: string; stdout?: string; message?: string };
    const detail = (e.stderr ?? e.stdout ?? e.message ?? String(error)).trim();
    throw new Error(`Failed to install ${spec}: ${detail}`);
  }

  return path.join(workDir, 'node_modules', name);
}

/**
 * Return the installed package path under cwd/node_modules, or null if not installed.
 */
export function getInstalledPackagePath(name: string, cwd?: string): string | null {
  const workDir = cwd ?? process.cwd();
  const pkgJsonPath = path.join(workDir, 'node_modules', name, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    return path.dirname(pkgJsonPath);
  }
  // eslint-disable-next-line unicorn/no-null
  return null;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
