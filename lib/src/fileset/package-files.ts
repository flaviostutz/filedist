import fs from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { SelectorConfig } from '../types';
import { isBinaryFile } from '../utils';

import { MARKER_FILE, DEFAULT_FILENAME_PATTERNS } from './constants';

/**
 * Returns the installed package path from node_modules in cwd, or null if not found.
 */
export function installedPackagePath(name: string, cwd?: string): string | null {
  const workDir = cwd ?? process.cwd();
  const pkgPath = path.join(workDir, 'node_modules', name, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return path.dirname(pkgPath);
  }
  // eslint-disable-next-line unicorn/no-null
  return null;
}

/**
 * Enumerate all files in a package directory that match the selector.
 * Applies DEFAULT_FILENAME_PATTERNS when `files` is absent.
 * Binary files always skip contentRegexes check (but are included by glob).
 *
 * @returns Array of relative file paths from the package root.
 */
export async function enumeratePackageFiles(
  pkgPath: string,
  selector: SelectorConfig,
): Promise<string[]> {
  const filePatterns = selector.files ?? DEFAULT_FILENAME_PATTERNS;
  const contentRegexes = (selector.contentRegexes ?? []).map((r) => new RegExp(r));
  const results: string[] = [];

  const walkDir = (dir: string, basePath = ''): void => {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry === MARKER_FILE) continue;

      const fullPath = path.join(dir, entry);
      const relPath = basePath ? `${basePath}/${entry}` : entry;
      const lstat = fs.lstatSync(fullPath);

      if (lstat.isSymbolicLink()) continue;

      if (lstat.isDirectory()) {
        walkDir(fullPath, relPath);
        continue;
      }

      // Apply glob filter
      if (!matchesFilePatterns(relPath, filePatterns)) continue;

      // Apply content regex filter (skip for binary files)
      if (contentRegexes.length > 0 && !isBinaryFile(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = contentRegexes.some((re) => re.test(content));
        if (!matches) continue;
      }
      // Binary files pass through when contentRegexes are set, since they
      // cannot be scanned but may be legitimately needed

      results.push(relPath);
    }
  };

  walkDir(pkgPath);
  return results;
}

/**
 * Check whether a relative file path matches the given glob patterns.
 * Handles negative patterns (prefix !) and positive patterns.
 */
function matchesFilePatterns(relPath: string, patterns: string[]): boolean {
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));

  const matchesIncludes =
    includes.length === 0 || includes.some((pat) => minimatch(relPath, pat, { dot: true }));

  const matchesExcludes = excludes.some((pat) => minimatch(relPath, pat, { dot: true }));

  return matchesIncludes && !matchesExcludes;
}
