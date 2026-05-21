/* eslint-disable no-console */

const VERSION = '2.0.0';

/**
 * Print usage/help text for the given command to stdout.
 * When no command is provided, print the top-level command index.
 */
export function printUsage(command?: string): void {
  const cmd = command;

  switch (cmd) {
    case 'install':
      console.log(`
Usage: filedist [install] [options]

Install files from one or more npm packages into a local output directory.
Reads (or creates) .filedist.lock to pin exact package versions for reproducible installs.
In config-file mode, the root-level postExtractCmd runs after a successful non-dry-run install.

Options:
  --packages <specs>      Comma-separated package specs (e.g. my-pkg@^1.2.3, git:github.com/org/repo.git@main). Overrides config sets.
  --output, -o <dir>      Output directory path. Required when --packages is used.
  --files <globs>         Comma-separated glob patterns for file selection.
  --content-regex <re>    Comma-separated regex strings for content filtering.
  --force                 Overwrite existing unmanaged files.
  --mutable               Skip files that already exist; mark extracted files as mutable (check ignores content changes).
  --nosync [bool]         Keep stale managed files on disk during install (default: false).
  --gitignore [bool]      Enable/disable .gitignore update (default: true). Use --gitignore=false to disable.
  --managed [bool]        Enable/disable managed mode (default: true). Use --managed=false to write without .filedist marker.
  --dry-run               Report changes without writing to disk.
  --upgrade               Force fresh package install even if satisfying version installed.
  --frozen-lockfile       Use .filedist.lock exclusively; fail if lock file does not exist. Does not update the lock file.
  --presets <tags>        Comma-separated preset tags; only matching entries are processed. Overrides config defaultPresets.
  --all                   Ignore config defaultPresets and process all configured entries.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --silent                Suppress per-file output; print only final summary line.
  --verbose, -v           Print detailed step information.
  --help                  Print this help text.
  --version               Print version.

Exit codes: 0 success | 1 error
`);
      break;

    case 'check':
      console.log(`
Usage: filedist check [options]

Verify that locally installed files match the pinned state in .filedist.lock.
Reads set definitions and pinned package versions exclusively from .filedist.lock.
Fails if the lock file does not exist. The configuration file is not used.

Options:
  --local-only            Skip all package installs/git clones. Verify only against
                          .filedist marker checksums (including marker self-integrity check).
                          Extra-file detection is skipped. Useful for offline/CI environments.
  --verbose, -v           Print detailed comparison information.
  --help                  Print this help text.

Exit codes: 0 all in sync | 1 drift detected or error
`);
      break;

    case 'list':
      console.log(`
Usage: filedist list [options]

Print all files currently managed by filedist in the output directory.

Options:
  --output, -o <dir>      Output directory to inspect.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --verbose, -v           Print additional metadata per file.
  --help                  Print this help text.

Output format: <relPath>  <packageName>@<packageVersion>
Exit codes: 0 always
`);
      break;

    case 'remove':
      console.log(`
Usage: filedist remove <package> [options]

Remove a package from the filedist configuration and delete its managed files.
The version/ref part of <package> is ignored during matching, so both
"xdrs-core" and "xdrs-core@1.0.0" match any config entry for xdrs-core.
After updating the config, a full install is run with the remaining entries
so orphaned files are deleted from output directories and the lockfile is updated.

Arguments:
  <package>               Package name to remove (e.g. xdrs-core, @scope/pkg).

Options:
  --output, -o <dir>      Only remove entries whose output.path matches this value.
                          When omitted, all entries for the package are removed.
  --dry-run               Report what would change without modifying config or disk.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc).
  --silent                Suppress per-file output; print only the final summary line.
  --verbose, -v           Print detailed step information.
  --help                  Print this help text.

Exit codes: 0 success | 1 error
`);
      break;

    case 'update':
      console.log(`
Usage: filedist update [options]

Update installed files to the latest available package versions.
Reads set definitions from .filedist.lock, resolves the newest matching versions,
runs a full install and writes an updated lockfile.
Fails if no lock file exists (run 'filedist install' first).

Options:
  --dry-run               Report what would change without writing to disk.
  --silent                Suppress per-file output; print only final summary.
  --verbose, -v           Print detailed step information.
  --help                  Print this help text.

Exit codes: 0 success | 1 error
`);
      break;

    case 'init':
      console.log(`
Usage: filedist init [options]

Scaffold a new publishable npm data package.

Options:
  --output, -o <dir>      Directory to scaffold into (default: current dir).
  --verbose, -v           Print scaffolding steps.
  --help                  Print this help text.

Created files: package.json, bin/filedist.js
Exit codes: 0 success | 1 target dir has conflicting files
`);
      break;

    case 'presets':
      console.log(`
Usage: filedist presets

List all unique preset tags defined in the configuration.
Presets are declared in each entry's "presets" field and can be used
to selectively run extract, check, or purge via --presets <tag>.

Options:
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --help                  Print this help text.

Output format: one preset per line, sorted alphabetically
Exit codes: 0 success | 1 no configuration found
`);
      break;

    default:
      console.log(`
Usage: filedist [command] [options]

Commands:
  install (default)  Install files from npm packages; writes .filedist.lock
  update             Bump packages to latest versions; re-installs and updates lock file
  remove             Remove a package from config and delete its managed files
  check              Verify installed files match the pinned state in .filedist.lock
  list               List all managed files
  init               Scaffold a publishable data package
  presets            List all preset tags defined in configuration

Run 'filedist <command> --help' for command-specific help.
Version: ${VERSION}
`);
  }
}

export function printVersion(): void {
  // Try to read version from package.json
  console.log(`filedist v${VERSION}`);
}
