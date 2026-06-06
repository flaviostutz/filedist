import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSourceRuntime, parsePackageTarget } from './source';

describe('parsePackageTarget', () => {
  it('defaults to npm when no prefix is present', () => {
    expect(parsePackageTarget('my-pkg@^1.2.3')).toEqual({
      source: 'npm',
      packageName: 'my-pkg',
      requestedVersion: '^1.2.3',
    });
  });

  it('parses an explicit npm prefix', () => {
    expect(parsePackageTarget('npm:@scope/my-pkg@2.x')).toEqual({
      source: 'npm',
      packageName: '@scope/my-pkg',
      requestedVersion: '2.x',
    });
  });

  it('parses a git package with an https repository URL', () => {
    expect(parsePackageTarget('git:https://github.com/acme/repo.git@main')).toEqual({
      source: 'git',
      packageName: 'https://github.com/acme/repo.git',
      requestedVersion: 'main',
      repository: 'https://github.com/acme/repo.git',
    });
  });

  it('parses a git package with a host/path shorthand', () => {
    expect(parsePackageTarget('git:github.com/acme/repo.git@main')).toEqual({
      source: 'git',
      packageName: 'https://github.com/acme/repo.git',
      requestedVersion: 'main',
      repository: 'https://github.com/acme/repo.git',
    });
  });

  it('throws when a git repository spec is missing the git prefix', () => {
    expect(() => parsePackageTarget('https://github.com/acme/repo.git@main')).toThrow(
      'Git repository specs must use the "git:" prefix.',
    );
  });
});

describe('parsePackageTarget — local (file://) source', () => {
  it('parses a relative path', () => {
    expect(parsePackageTarget('file://./relative/dir')).toEqual({
      source: 'local',
      packageName: './relative/dir',
    });
  });

  it('parses an absolute path', () => {
    expect(parsePackageTarget('file:///absolute/path')).toEqual({
      source: 'local',
      packageName: '/absolute/path',
    });
  });

  it('parses a relative path without leading dot-slash', () => {
    expect(parsePackageTarget('file://relative/path')).toEqual({
      source: 'local',
      packageName: 'relative/path',
    });
  });

  it('throws when the path is missing after file://', () => {
    expect(() => parsePackageTarget('file://')).toThrow(
      'Package spec is missing a path after the "file://" prefix.',
    );
  });
});

describe('createSourceRuntime — local (file://) resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-source-local-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves an absolute path and returns packageVersion "0"', async () => {
    const pkgDir = path.join(tmpDir, 'mypkg');
    fs.mkdirSync(pkgDir);

    const runtime = createSourceRuntime(tmpDir);
    const result = await runtime.resolvePackage({ package: `file://${pkgDir}` }, false);

    expect(result.source).toBe('local');
    expect(result.packagePath).toBe(pkgDir);
    expect(result.packageVersion).toBe('0');
  });

  it('resolves a relative path against cwd', async () => {
    const pkgDir = path.join(tmpDir, 'relative-pkg');
    fs.mkdirSync(pkgDir);

    const runtime = createSourceRuntime(tmpDir);
    const result = await runtime.resolvePackage({ package: 'file://./relative-pkg' }, false);

    expect(result.source).toBe('local');
    expect(result.packagePath).toBe(pkgDir);
    expect(result.packageVersion).toBe('0');
  });

  it('records the spec in getResolvedPackages with version "0"', async () => {
    const pkgDir = path.join(tmpDir, 'tracked-pkg');
    fs.mkdirSync(pkgDir);

    const runtime = createSourceRuntime(tmpDir);
    await runtime.resolvePackage({ package: `file://${pkgDir}` }, false);

    const resolved = runtime.getResolvedPackages();
    expect(resolved.get(`file://${pkgDir}`)).toEqual({ source: 'local', resolvedVersion: '0' });
  });

  it('throws when the directory does not exist', async () => {
    const runtime = createSourceRuntime(tmpDir);
    await expect(
      runtime.resolvePackage({ package: 'file:///nonexistent/path/that/does/not/exist' }, false),
    ).rejects.toThrow('Local package directory not found');
  });

  it('throws when the path exists but is a file, not a directory', async () => {
    const filePath = path.join(tmpDir, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'content');

    const runtime = createSourceRuntime(tmpDir);
    await expect(runtime.resolvePackage({ package: `file://${filePath}` }, false)).rejects.toThrow(
      'Local package path is not a directory',
    );
  });
});
