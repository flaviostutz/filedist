import { parsePackageTarget } from './source';

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
