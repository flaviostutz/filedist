/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FiledistExtractEntry } from '../types';
import { formatDisplayPath, installOrUpgradePackage, spawnWithLog } from '../utils';

export type PackageTarget = {
  source: 'npm' | 'git' | 'local';
  packageName: string;
  requestedVersion?: string;
  repository?: string;
};

export type ResolvedPackageSource = {
  source: 'npm' | 'git' | 'local';
  packageName: string;
  packageVersion: string;
  packagePath: string;
};

export type SourceRuntime = {
  resolvePackage: (entry: FiledistExtractEntry, upgrade: boolean) => Promise<ResolvedPackageSource>;
  /**
   * Phase 2 sparse expansion: adds `patterns` to the sparse checkout of a previously
   * cloned git package and runs `git checkout` to materialise the newly matched files.
   * No-op when `patterns` is empty or the clone dir has no `.git` (e.g. npm package).
   */
  expandGitSparseCheckout: (packagePath: string, patterns: string[]) => void;
  cleanup: () => void;
  /**
   * Returns all packages resolved during this runtime's lifetime.
   * Key is the original spec string (e.g. "eslint@^8"). Value contains source and resolved version.
   */
  getResolvedPackages: () => Map<
    string,
    { source: 'npm' | 'git' | 'local'; resolvedVersion: string }
  >;
  /**
   * Pin exact versions for known specs. When set, resolvePackage substitutes
   * the pinned version instead of resolving from npm/git registries.
   */
  setLockedVersions: (locked: Map<string, string>) => void;
};

type PackageSourceKind = 'npm' | 'git' | 'local';

const GIT_SOURCE_REGEX = /^(?:https?|ssh|git|file):\/\/|^git@/i;
const SOURCE_PREFIX_REGEX = /^(npm|git):(.*)$/s;
const GIT_HOST_PATH_REGEX = /^[\d.A-Za-z-]+\.[A-Za-z]{2,}(?::\d+)?[/:].+/;
const FILE_SOURCE_REGEX = /^file:\/\//i;
export function parsePackageTarget(spec: string): PackageTarget {
  const { source, value } = parsePackageSpecWithSource(spec);
  if (source === 'local') {
    return { source, packageName: value };
  }
  if (source === 'npm') {
    if (GIT_SOURCE_REGEX.test(value)) {
      throw new Error(
        `Git repository specs must use the "git:" prefix. Received "${spec}". ` +
          'Use a package string such as "git:github.com/org/repo.git@ref".',
      );
    }

    const atIdx = value.lastIndexOf('@');
    if (atIdx > 0) {
      const requestedVersion = value.slice(atIdx + 1);
      return {
        source,
        packageName: value.slice(0, atIdx),
        ...(requestedVersion ? { requestedVersion } : {}),
      };
    }
    return { source, packageName: value };
  }

  const normalizedSpec = normalizeGitSpec(value);
  const { repository, ref } = splitGitSpec(normalizedSpec);
  return {
    source,
    packageName: normalizeGitRepository(repository),
    ...(ref ? { requestedVersion: ref } : {}),
    repository,
  };
}

export function createSourceRuntime(cwd: string, verbose = false): SourceRuntime {
  const packageCache = new Map<string, ResolvedPackageSource>();
  const cloneDirs = new Set<string>();
  let tempRoot = '';
  // Map from original spec string → resolved version info (populated during resolvePackage calls)
  const resolvedSpecMap = new Map<
    string,
    { source: 'npm' | 'git' | 'local'; resolvedVersion: string }
  >();
  // Optional frozen version map: spec → exact pinned version

  let lockedVersions: Map<string, string> | undefined;

  const ensureTempRoot = (): string => {
    if (!tempRoot) {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-git-'));
      if (verbose) {
        console.log(`[verbose] source: using temp git directory ${tempRoot}`);
      }
    }
    return tempRoot;
  };

  return {
    async resolvePackage(
      entry: FiledistExtractEntry,
      upgrade: boolean,
    ): Promise<ResolvedPackageSource> {
      if (!entry.package) {
        throw new Error('resolvePackage requires an entry with a package spec');
      }

      const originalSpec = entry.package;
      const target = parsePackageTarget(originalSpec);

      // When locked versions are set, pin the requested version (branch/tag/commit for git, semver for npm)
      // eslint-disable-next-line no-undefined
      if (lockedVersions !== undefined) {
        const pinnedVersion = lockedVersions.get(originalSpec);
        // eslint-disable-next-line no-undefined
        if (pinnedVersion !== undefined) {
          target.requestedVersion = pinnedVersion;
        }
      }

      const sparsePatterns = entry.selector?.files ?? [];
      const patternsKey = [...sparsePatterns].sort().join('\0');
      const cacheKey = `${target.source}|${target.packageName}|${target.requestedVersion ?? ''}|${patternsKey}`;

      if (!upgrade) {
        const cached = packageCache.get(cacheKey);
        if (cached) {
          resolvedSpecMap.set(originalSpec, {
            source: cached.source,
            resolvedVersion: cached.packageVersion,
          });
          return cached;
        }
      }

      let resolved: Promise<ResolvedPackageSource>;
      if (target.source === 'git') {
        resolved = resolveGitPackage(target, cwd, ensureTempRoot, verbose, sparsePatterns);
      } else if (target.source === 'local') {
        resolved = Promise.resolve(resolveLocalPackage(target, cwd));
      } else {
        resolved = resolveNpmPackage(target, upgrade, cwd, verbose);
      }

      const packageSource = await resolved;
      packageCache.set(cacheKey, packageSource);
      resolvedSpecMap.set(originalSpec, {
        source: packageSource.source,
        resolvedVersion: packageSource.packageVersion,
      });
      if (packageSource.source === 'git') {
        cloneDirs.add(packageSource.packagePath);
      }
      return packageSource;
    },
    expandGitSparseCheckout(packagePath: string, patterns: string[]): void {
      if (patterns.length === 0) return;
      const gitDir = path.join(packagePath, '.git');
      if (!fs.existsSync(gitDir)) return;
      if (verbose) {
        console.log(
          `[verbose] source: expanding sparse checkout at ${formatDisplayPath(packagePath, cwd)} with [${patterns.join(', ')}]`,
        );
      }
      spawnWithLog(
        'git',
        ['-C', packagePath, 'sparse-checkout', 'set', '--no-cone', ...patterns],
        cwd,
        verbose,
        true,
      );
      spawnWithLog('git', ['-C', packagePath, 'checkout'], cwd, verbose, true);
    },
    getResolvedPackages(): Map<
      string,
      { source: 'npm' | 'git' | 'local'; resolvedVersion: string }
    > {
      return new Map(resolvedSpecMap);
    },
    setLockedVersions(locked: Map<string, string>): void {
      lockedVersions = locked;
    },
    cleanup(): void {
      for (const cloneDir of cloneDirs) {
        if (fs.existsSync(cloneDir)) {
          fs.rmSync(cloneDir, { recursive: true, force: true });
        }
      }
      cloneDirs.clear();

      if (tempRoot && fs.existsSync(tempRoot)) {
        try {
          fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      }
    },
  };
}

function parsePackageSpecWithSource(spec: string): { source: PackageSourceKind; value: string } {
  if (FILE_SOURCE_REGEX.test(spec)) {
    const value = spec.slice('file://'.length);
    if (!value) {
      throw new Error('Package spec is missing a path after the "file://" prefix.');
    }
    return { source: 'local', value };
  }

  const match = spec.match(SOURCE_PREFIX_REGEX);
  if (!match) {
    return { source: 'npm', value: spec };
  }

  const [, source, value] = match;
  if (!value) {
    throw new Error(`Package spec is missing a value after the "${source}:" prefix.`);
  }

  return { source: source as PackageSourceKind, value };
}

function normalizeGitSpec(spec: string): string {
  if (GIT_SOURCE_REGEX.test(spec)) {
    return spec;
  }

  if (GIT_HOST_PATH_REGEX.test(spec)) {
    return `https://${spec}`;
  }

  throw new Error(
    `Git package specs must point to a repository URL or host/path. Received "${spec}". ` +
      'Use a package string such as "git:https://host/org/repo.git@ref" or ' +
      '"git:github.com/org/repo.git@ref".',
  );
}

function splitGitSpec(spec: string): { repository: string; ref?: string } {
  if (spec.startsWith('git@')) {
    const firstAt = spec.indexOf('@');
    const lastAt = spec.lastIndexOf('@');
    if (lastAt > firstAt) {
      const ref = spec.slice(lastAt + 1);
      return { repository: spec.slice(0, lastAt), ...(ref ? { ref } : {}) };
    }
    return { repository: spec };
  }

  const schemeEnd = spec.indexOf('://');
  if (schemeEnd !== -1) {
    const authStart = schemeEnd + 3;
    const pathStart = spec.indexOf('/', authStart);
    const authEnd = pathStart === -1 ? spec.length : pathStart;
    const lastAt = spec.lastIndexOf('@');
    if (lastAt >= authEnd) {
      const ref = spec.slice(lastAt + 1);
      return { repository: spec.slice(0, lastAt), ...(ref ? { ref } : {}) };
    }
    return { repository: spec };
  }

  throw new Error(
    `Git package specs must point to a repository URL or host/path. Received "${spec}". ` +
      'Use a package string such as "git:https://host/org/repo.git@ref" or ' +
      '"git:github.com/org/repo.git@ref".',
  );
}

function normalizeGitRepository(repository: string): string {
  return repository.replace(/\/+$/, '');
}

function resolveLocalPackage(target: PackageTarget, cwd: string): ResolvedPackageSource {
  const resolvedPath = path.isAbsolute(target.packageName)
    ? target.packageName
    : path.resolve(cwd, target.packageName);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Local package directory not found: "${resolvedPath}". ` +
        `Spec was "file://${target.packageName}".`,
    );
  }
  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(
      `Local package path is not a directory: "${resolvedPath}". ` +
        `Spec was "file://${target.packageName}".`,
    );
  }

  return {
    source: 'local',
    packageName: target.packageName,
    packageVersion: '0',
    packagePath: resolvedPath,
  };
}

async function resolveNpmPackage(
  target: PackageTarget,
  upgrade: boolean,
  cwd: string,
  verbose: boolean,
): Promise<ResolvedPackageSource> {
  const packagePath = await installOrUpgradePackage(
    target.packageName,
    target.requestedVersion,
    upgrade,
    cwd,
    verbose,
  );

  let installedVersion = '0.0.0';
  try {
    const pkgJsonContent = JSON.parse(
      fs.readFileSync(path.join(packagePath, 'package.json')).toString(),
    ) as { version: string };
    installedVersion = pkgJsonContent.version;
  } catch {
    // fallback
  }

  return {
    source: 'npm',
    packageName: target.packageName,
    packageVersion: installedVersion,
    packagePath,
  };
}

async function resolveGitPackage(
  target: PackageTarget,
  cwd: string,
  ensureTempRoot: () => string,
  verbose: boolean,
  sparsePatterns: string[] = [],
): Promise<ResolvedPackageSource> {
  const tempRoot = ensureTempRoot();

  const cloneDir = path.join(tempRoot, buildCloneDirName(target, sparsePatterns));
  if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }

  if (verbose) {
    console.log(
      `[verbose] source: cloning ${target.repository} into ${formatDisplayPath(cloneDir, cwd)}`,
    );
  }

  // Phase 1: sparse clone — always fetch only config files + any explicit caller patterns.
  // This lets us read nested filedist config before deciding which content files to fetch.
  // .git is intentionally kept alive so phase 2 (expandGitSparseCheckout) can run later.
  spawnWithLog(
    'git',
    ['clone', '--filter=blob:none', '--no-checkout', '--sparse', target.repository!, cloneDir],
    cwd,
    verbose,
    true,
  );

  const configFilePatterns = ['.filedist-package.yml'];
  const phase1Patterns = [...new Set([...configFilePatterns, ...sparsePatterns])];
  spawnWithLog(
    'git',
    ['-C', cloneDir, 'sparse-checkout', 'set', '--no-cone', ...phase1Patterns],
    cwd,
    verbose,
    true,
  );

  const checkoutRef = target.requestedVersion
    ? ['-C', cloneDir, 'checkout', target.requestedVersion]
    : ['-C', cloneDir, 'checkout'];
  spawnWithLog('git', checkoutRef, cwd, verbose, true);

  const revision = spawnWithLog('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], cwd, verbose, true)
    .stdout.toString()
    .trim();

  return {
    source: 'git',
    packageName: target.packageName,
    packageVersion: revision ? revision.slice(0, 12) : target.requestedVersion || 'HEAD',
    packagePath: cloneDir,
  };
}

function buildCloneDirName(target: PackageTarget, sparsePatterns: string[] = []): string {
  const pathSegments = target.packageName.split(/[/:]/).filter(Boolean);
  const lastPathSegment = pathSegments.at(-1);
  const baseName = lastPathSegment?.replace(/\.git$/, '')?.replace(/[^\w.-]+/g, '-') ?? 'repo';
  const patternsFingerprint = [...sparsePatterns].sort().join('\0');
  const digest = crypto
    .createHash('sha1')
    .update(`${target.packageName}@${target.requestedVersion ?? ''}\0${patternsFingerprint}`)
    .digest('hex')
    .slice(0, 12);
  return `${baseName}-${digest}`;
}
