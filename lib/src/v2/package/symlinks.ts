/* eslint-disable no-restricted-syntax */
/* eslint-disable functional/no-try-statements */
import fs from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { SymlinkConfig } from '../types';
import { ensureDir } from '../utils';

/**
 * Create symlinks for all files/dirs in outputDir matching source globs.
 * Each matching source is symlinked into the target directory.
 * Symlinks are created as relative paths.
 */
export async function createSymlinks(outputDir: string, configs: SymlinkConfig[]): Promise<void> {
  for (const config of configs) {
    const targetDir = path.resolve(outputDir, config.target);
    ensureDir(targetDir);

    const matches = findMatchingPaths(outputDir, config.source);
    for (const relPath of matches) {
      const srcAbsPath = path.join(outputDir, relPath);
      const linkName = path.basename(relPath);
      const linkPath = path.join(targetDir, linkName);

      // Remove existing symlink if present
      if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
        fs.unlinkSync(linkPath);
      }

      // Create relative symlink
      const relTarget = path.relative(targetDir, srcAbsPath);
      fs.symlinkSync(relTarget, linkPath);
    }
  }
}

/**
 * Remove stale symlinks in outputDir that no longer match their source globs.
 * (Called at the start of each extract run before diffing.)
 */
export async function removeStaleSymlinks(
  outputDir: string,
  configs: SymlinkConfig[],
): Promise<void> {
  for (const config of configs) {
    const targetDir = path.resolve(outputDir, config.target);
    if (!fs.existsSync(targetDir)) continue;

    const currentMatches = new Set(
      findMatchingPaths(outputDir, config.source).map((p) => path.basename(p)),
    );

    for (const entry of fs.readdirSync(targetDir)) {
      const linkPath = path.join(targetDir, entry);
      if (!isSymlink(linkPath)) continue;

      if (!currentMatches.has(entry)) {
        try {
          fs.unlinkSync(linkPath);
        } catch {
          // ignore
        }
      }
    }
  }
}

/**
 * Remove ALL symlinks pointing into outputDir (used during purge).
 */
export async function removeAllSymlinks(outputDir: string): Promise<number> {
  let count = 0;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (isSymlink(fullPath)) {
        try {
          const target = fs.readlinkSync(fullPath);
          const absTarget = path.resolve(path.dirname(fullPath), target);
          if (absTarget.startsWith(outputDir)) {
            fs.unlinkSync(fullPath);
            count += 1;
          }
        } catch {
          // ignore
        }
      } else if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath);
      }
    }
  };
  walk(outputDir);
  return count;
}

function findMatchingPaths(outputDir: string, glob: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, baseDir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const relPath = path.relative(baseDir, fullPath);
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) continue;
      if (minimatch(relPath, glob, { dot: true })) {
        results.push(relPath);
      }
      if (lstat.isDirectory()) {
        walk(fullPath, baseDir);
      }
    }
  };
  walk(outputDir, outputDir);
  return results;
}

function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
