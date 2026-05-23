# filedist

Publish folders as npm packages or git repositories and extract them in any workspace. Use it to distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry or directly from git.

## How it works

- **Publisher**: a project that has folders to share. Running `init` prepares its `package.json` so those folders are included when the package is published.
- **Consumer**: any project that installs that package and runs `install` to download the files locally. A `.filedist` marker file is written alongside the managed files to track ownership and enable safe updates.

## Extraction patterns

There are three ways to extract data with `filedist`. Choose the one that fits your situation:

### Pattern 1 — Ad-hoc CLI extraction

Use `npx filedist install` directly from the command line whenever you need to pull files from a package without any prior setup.

```sh
npx filedist install my-shared-assets@^2.0.0 --output ./data

# or use a git repository as the source
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

Package specs support optional source prefixes. Use `git:` for git repositories and `npm:` when you want to make the npm source explicit. When no prefix is present, filedist treats the spec as npm. Git specs accept full repository URLs and host/path shorthands such as `git:github.com/org/repo.git@ref`.

#### Auto-save to `.filedist.yml`

Whenever a package argument is supplied, filedist automatically creates or updates a `.filedist.yml` file in the current directory with the package and selectors from that run. This means subsequent updates can be done with a single command — no flags needed:

```sh
# First run: extract and save to .filedist.yml automatically
npx filedist install my-shared-assets@^2.0.0 --output ./data

# .filedist.yml is now created:
# sets:
#   - package: my-shared-assets@^2.0.0
#     output:
#       path: ./data

# Future bumps: just run install (reads .filedist.yml)
npx filedist install

# Or bump to a newer version
npx filedist install my-shared-assets@^3.0.0 --output ./data
# .filedist.yml is updated in place (same entry, new version)
```

If the entry already exists in `.filedist.yml` with identical content, the file is left unchanged. Use `--no-save` to run a one-off extraction without reading or updating `.filedist.yml`:

```sh
npx filedist install my-shared-assets@^2.0.0 --output ./tmp --no-save
```

### Pattern 2 — Data packages with embedded configuration

Create a dedicated npm package with a `.filedist-package.yml` file that encodes the extraction sources, output directories, filtering rules, and any combination of upstream packages. Consumers install the data package and run its bundled script — they don't need to know the internals.

**Publisher** — create a `.filedist-package.yml` in the data package root:

```yaml
sets:
  - package: base-datasets@^3.0.0
    selector:
      files:
        - datasets/**
    output:
      path: ./data/base

  - package: org-configs@^1.2.0
    selector:
      contentRegexes:
        - env: production
    output:
      path: ./configs

  - package: git:github.com/flaviostutz/xdrs-core@1.3.0
    selector:
      files:
        - docs/**
    output:
      path: ./xdrs
```

Run `pnpm dlx filedist init` in that package and then `npm publish` to release it.

**Consumer** — just install and run:

```sh
npx my-org-configs extract --output ./local-data
```

No knowledge of the upstream packages or transformation rules is required.

**When to use:** When an intermediary team (a platform, infrastructure, or data team) wants to bundle, curate, and version a collection of data from multiple sources and hand it to consumers as a single, opinionated package. Consumers get a stable, self-describing interface; producers control all the complexity.

### Pattern 3 — Config file mode

Add a `.filedist.yml` file to your project and run `filedist install` without a package argument. The CLI automatically loads the configuration and runs every entry, reusing the same runner logic as data packages.

**Consumer** — create a `.filedist.yml` in the project root:

```yaml
defaultPresets:
  - prod
sets:
  - package: base-datasets@^3.0.0
    selector:
      files:
        - datasets/**
    output:
      path: ./data

  - package: git:github.com/flaviostutz/xdrs-core@1.3.0
    selector:
      files:
        - docs/**
    output:
      path: ./xdrs
```

For a local git repository, use the `file://` form with an absolute path, for example `git:file:///absolute/path/to/local-repo@v2.0.0`. On Windows use a drive letter: `git:file:///C:/work/local-repo@v2.0.0`.

Then run any command without a package argument:

```sh
npx filedist           # same as 'npx filedist install'
npx filedist install   # reads .filedist.yml, extracts all entries or only defaultPresets when defined
npx filedist check     # checks the same effective set selection
```

filedist reads only `.filedist.yml` from the current working directory. No parent-directory traversal is performed.

All runner flags (`--dry-run`, `--silent`, `--verbose`, `--gitignore=false`, `--managed=false`, `--presets`, `--output`) work as usual.
When `filedist.defaultPresets` is defined, `install` and `check` behave as if `--presets <tags>` had been passed automatically. Passing `--presets` explicitly overrides that configured default for the current invocation.
Use `--all` to ignore `defaultPresets` for one run and process every configured entry.

Config-file mode can mix npm packages and git repositories in the same `sets` array. Use the `git:` prefix for git entries.

**When to use:** When a consuming project wants to pin and automate a set of data extractions locally without publishing a separate data package. This is the lightest-weight approach — no extra package, no `init` step, just a config block and a single CLI call.

---

## Quick start

### 1. Prepare the publisher package

In the project whose folders you want to share:

```sh
# share specific folders by glob pattern (required)
pnpm dlx filedist init --files "docs/**,data/**,configs/**"

# to also bundle upstream packages, add them manually to .filedist-package.yml after init
pnpm dlx filedist init --files "docs/**"
# then edit .filedist-package.yml and add entries for shared-configs@^1.0.0, git sources, etc.

```

`init` updates `package.json` with the right `files`, `bin`, and `dependencies` fields so those folders are included when the package is published, and writes a thin `bin/filedist.js` entry point. Then publish normally:

```sh
npm publish
```

### 2. Extract files in a consumer project

```sh
# npm package examples
npx filedist install my-shared-assets --output ./data
npx filedist install my-shared-assets@^2.0.0 --output ./data
npx filedist install my-shared-assets --files "**/*.md" --output ./docs
npx filedist install my-shared-assets --content-regex "env: production" --output ./configs
npx filedist install my-shared-assets --output ./data --force
npx filedist install my-shared-assets --output ./data --gitignore=false
npx filedist install my-shared-assets --output ./data --managed=false
npx filedist install my-shared-assets --output ./data --dry-run
npx filedist install my-shared-assets@latest --output ./data --upgrade

# git source examples
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
npx filedist install git:github.com/flaviostutz/xdrs-core@main --output ./xdrs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --files "docs/**/*.md" --output ./docs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --content-regex "Decision Outcome" --output ./filtered-docs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --force
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --gitignore=false
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --managed=false
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --dry-run
npx filedist install git:github.com/flaviostutz/xdrs-core@main --output ./xdrs --upgrade
# For multiple packages at once, use a config file (.filedistrc) and run: npx filedist install
```

`install` logs every file change as it happens:

```
  + data/users-dataset/user1.json (M,I)
  ~ data/configs/app.config.json (M,I)
  - data/old-file.json
```

If the published package includes its own bin script (normally when it's prepared using "init") you can also call it directly so it extracts data that is inside the package itself:

```sh
npx my-shared-assets install --output ./data
npx my-shared-assets check  --output ./data
```

When the data package defines multiple entries in its `.filedist-package.yml`, you can limit which entries are processed using the `--presets` option. Only entries whose `presets` list includes at least one of the requested presets will be extracted; entries with no presets are skipped when a preset filter is active.

```sh
# run only entries tagged with "prod"
npx my-shared-assets --presets prod

# run entries tagged with either "prod" or "staging"
npx my-shared-assets --presets prod,staging
```

To use presets, add a `presets` array to each entry in the data package's `.filedist-package.yml`:

```yaml
sets:
  - package: my-shared-assets
    output:
      path: ./data
    presets:
      - prod
  - package: my-dev-assets
    output:
      path: ./dev-data
    presets:
      - dev
      - staging
```

Check the /examples folder to see this in action

### Data package CLI options

When calling the bin script bundled in a data package, the following options are accepted. Options that overlap with per-entry settings override every entry globally, regardless of what is set in `package.json`.

| Option | Description |
|---|---|
| `--output, -o <dir>` | Base directory for resolving all `output.path` values (default: cwd). |
| `--presets <preset1,preset2>` | Limit to entries whose `presets` overlap with the given list (comma-separated). |
| `--nosync [bool]` | Keep stale managed files on disk during extract instead of deleting them. `check` still reports them as extra drift. |
| `--gitignore [bool]` | Disable `.gitignore` management for every entry when set to `false`, overriding each entry's `gitignore` field. |
| `--managed [bool]` | Run every entry in unmanaged mode when set to `false`, overriding each entry's `managed` field. Files are written without a `.filedist` marker, without `.gitignore` updates, and without being made read-only. |
| `--dry-run` | Simulate changes without writing or deleting any files. |
| `--verbose, -v` | Print detailed progress information for each step. |

```sh
# disable gitignore management across all entries
npx my-shared-assets --gitignore=false

# keep stale managed files on disk during extract
npx my-shared-assets --nosync

# write all files as not-managed (editable, not tracked)
npx my-shared-assets --managed=false

# combine overrides
npx my-shared-assets --gitignore=false --managed=false --dry-run
```

### filedist entry options reference

Each entry in the `filedist.sets` array in `package.json` supports the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `package` | `string` | required | Source spec to install and extract. Either npm (`my-pkg`, `npm:my-pkg@^1.2.3`) or git (`git:github.com/org/repo.git@ref`, `git:file:///tmp/repo@main`, `git:file:///C:/tmp/repo@main`). |
| `output.path` | `string` | `.` (cwd) | Directory where files will be extracted, relative to where the consumer runs the command. |
| `selector.files` | `string[]` | all files | Glob patterns to filter which files are extracted (e.g. `["data/**", "*.json"]`). |
| `selector.exclude` | `string[]` | `["package.json","bin/**","README.md","node_modules/**"]` (when `files` is unset), none otherwise | Glob patterns to exclude files even when they match `selector.files` (e.g. `["test/**", "**/*.test.*"]`). |
| `selector.contentRegexes` | `string[]` | none | Regex patterns (as strings) to filter files by content. Only files matching at least one pattern are extracted. |
| `output.force` | `boolean` | `false` | Allow overwriting existing files or files owned by a different package. |
| `output.mutable` | `boolean` | `false` | Skip files that already exist; mark extracted files as mutable (check ignores content changes). Cannot be combined with `force`. |
| `output.noSync` | `boolean` | `false` | Keep stale managed files on disk during extract instead of deleting them. `check` still reports them as extra drift until they are removed or synced. |
| `output.gitignore` | `boolean` | `true` | Create/update a `.gitignore` file alongside each `.filedist` marker file. Set to `false` to disable. |
| `output.managed` | `boolean` | `true` | Write files with a `.filedist` marker, `.gitignore` update, and read-only flag. Set to `false` to skip tracking. Existing files are skipped when set to `false`. |
| `output.dryRun` | `boolean` | `false` | Simulate extraction without writing anything to disk. |
| `selector.upgrade` | `boolean` | `false` | Force a fresh install of the package even when a satisfying version is already installed. |
| `silent` | `boolean` | `false` | Suppress per-file output, printing only the final result line. |
| `presets` | `string[]` | none | Presets used to group and selectively run entries with `--presets`. |
| `output.symlinks` | `SymlinkConfig[]` | none | Post-extract symlink operations (see below). |
| `output.contentReplacements` | `ContentReplacementConfig[]` | none | Post-extract content-replacement operations (see below). |

Top-level config fields:

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultPresets` | `string[]` | none | CLI-only fallback for config-file mode. `install` and `check` behave as if `--presets <tags>` had been passed when the flag is omitted. |
| `postExtractCmd` | `string[]` | none | Command argv run after a successful non-dry-run `install`. The first array item is the executable and the remaining items are its arguments. Full install argv is appended. |

#### SymlinkConfig

After extraction, for each config the runner resolves all files/directories inside `output.path` that match `source` and creates a corresponding symlink inside `target`. Stale symlinks pointing into `output.path` but no longer matched are removed automatically.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Glob pattern relative to `output.path`. Every matching file or directory gets a symlink in `target`. Example: `"**\/skills\/**"` |
| `target` | `string` | Directory where symlinks are created, relative to the project root. Example: `".github/skills"` |

#### ContentReplacementConfig

After extraction, for each config the runner finds workspace files matching `files` and applies the regex replacement to their contents.

| Field | Type | Description |
|---|---|---|
| `files` | `string` | Glob pattern (relative to the project root) selecting workspace files to modify. Example: `"docs/**\/*.md"` |
| `match` | `string` | Regex string locating the text to replace. Applied globally to all non-overlapping occurrences. Example: `"<!-- version: .* -->"` |
| `replace` | `string` | Replacement string. May contain regex back-references such as `$1`. Example: `"<!-- version: 1.2.3 -->"` |

Example with multiple options:

```yaml
sets:
  - package: my-shared-assets@^2.0.0
    selector:
      files:
        - docs/**
        - configs/*.json
      upgrade: true
    output:
      path: ./data
      gitignore: true
      symlinks:
        - source: "**/skills/**"
          target: .github/skills
      contentReplacements:
        - files: docs/**/*.md
          match: "<!-- version: .* -->"
          replace: "<!-- version: 2.0.0 -->"
    presets:
      - prod

  - package: git:github.com/flaviostutz/xdrs-core@1.3.0
    selector:
      files:
        - docs/**
      upgrade: true
    output:
      path: ./xdrs
      gitignore: false
    presets:
      - prod
```

### 3. Check files are in sync

Verifies that every file in the output directory matches what was installed. `check` reads exclusively from `.filedist.lock` — it does **not** read your `.filedist.yml` configuration and does **not** require `--packages`. The lockfile must exist (run `filedist install` first).

```sh
npx filedist check
# exit 0 = in sync, exit 1 = drift or error
```

`check` uses the pinned package versions recorded in `.filedist.lock` so results are fully reproducible without any network access beyond what is already cached.

The check command reports differences per package:

```
  my-shared-assets@2.1.0: out of sync
    - missing:  data/new-file.json
    ~ modified: data/configs/app.config.json
    + extra:    data/old-file.json
```

#### Offline / local-only check

By default `check` compares local files against the package versions pinned in `.filedist.lock` to also detect *extra* files — files that exist in the package source but were never extracted. If you want a fast, fully offline check that skips all network and install steps, use `--local-only`:

```sh
npx filedist check --local-only
```

In this mode filedist reads the `.filedist` marker file for each output directory and verifies:

1. **File checksums** — every non-mutable file listed in the marker is hashed and compared against the checksum recorded at extraction time.

Extra-file detection (files in the source that were never extracted) is skipped because no package source is available. Use `--local-only` when:

- Running in a **CI environment** where the package registry is unavailable or you want to avoid install latency.
- Checking **air-gapped** or **offline** environments.
- You only care that previously extracted files have not been **locally tampered with**, and are not concerned about new files added to the upstream package since the last extract.

### 4. List managed files

```sh
# list all files managed by filedist in an output directory
npx filedist list --output ./data
```

Output is grouped by package:

```
my-shared-assets@2.1.0
  data/users-dataset/user1.json
  data/configs/app.config.json

another-pkg@1.0.0
  data/other-file.txt
```

### 5. Remove a package set

Remove one or more set entries from your config file and delete their managed files from disk. `remove` reads your `.filedist.yml` config — **not** `.filedist.lock`. It deletes the matching entries from the config file, then runs a full install with the remaining entries so the lockfile is updated and orphaned files are deleted. This is equivalent to manually deleting the sets from your config and running `filedist install`.

```sh
# remove all entries for a package (version is ignored during matching)
npx filedist remove my-shared-assets

# remove only the entry pointing to a specific output directory
npx filedist remove my-shared-assets --output ./data

# remove every set entry from the config (clears all managed files)
npx filedist remove --all

# preview changes without modifying config or disk
npx filedist remove my-shared-assets --dry-run
```

After the config is updated, `remove` calls `install` internally (without `--frozen-lockfile`) so:
- The lockfile is rewritten with the remaining sets.
- Files that were managed by the removed package are deleted from disk.
- Files managed by other packages are left untouched.

### 6. Update to latest versions

Bumps all packages to their latest available versions, updates `.filedist.lock`, and re-extracts the files.

```sh
npx filedist update

# preview what would change without writing anything
npx filedist update --dry-run
```

`update` reads the current `sets` recorded in `.filedist.lock` (falling back to your config file if no lockfile exists), forces a fresh install of every package, and writes the new resolved versions back to `.filedist.lock`.

## Hierarchical package resolution

`extract` and `check` are all hierarchy-aware: when a target package or git repository carries its own `.filedist-package.yml`, the command automatically recurses into those transitive dependencies.

This lets you build layered data package chains:

```
consumer project
  └─ my-org-configs          (npm package with filedist.sets)
       ├─ base-datasets       (another npm package with its own files)
       └─ org-templates       (another npm package with its own files)
            └─ raw-assets     (leaf package)
```

Running `npx filedist install --packages my-org-configs --output ./data` will extract files from every package in the chain, not just `my-org-configs` itself.

When the source is git, filedist clones repositories into `.filedist-tmp` inside the working directory, adds that folder to `.gitignore` if needed, resolves nested config from the cloned repository, and removes `.filedist-tmp` when the command ends.

### Output path resolution

Each level's `output.path` is resolved relative to the caller's own `output.path`. A package at depth 1 with `output.path: "./configs"` and a transitive dependency with `output.path: "./shared"` will land at `./configs/shared`.

### Caller overrides (extract only)

When `extract` recurses, the caller's `output` flags are inherited by every transitive dependency, with caller-defined values always winning:

| Caller sets | Effect on transitive entries |
|---|---|
| `force: true` | Transitive entries also overwrite unmanaged / foreign files |
| `dryRun: true` | No files are written anywhere in the hierarchy |
| `mutable: true` | Existing files are skipped at every level; extracted files are marked as mutable |
| `gitignore: false` | No `.gitignore` entries are created anywhere |
| `managed: false` | All transitive files are written without a marker or read-only flag |
| `symlinks` / `contentReplacements` | Appended to each transitive entry's own lists |

Settings that are undefined on the caller are left as-is so the transitive package's own defaults apply.

### Filtering transitive sets with `selector.presets`

Set `selector.presets` on an entry to control which sets inside the target package are recursed into. Only sets whose `presets` tag overlaps with the filter are processed; sets with no `presets` are skipped when a filter is active.

```yaml
sets:
  - package: my-org-configs@^2.0.0
    output:
      path: ./data
    selector:
      presets:
        - prod
```

The same filtering is applied during `check` so they stay in sync with what `extract` originally wrote.

### Circular dependency detection

If a package chain references itself (directly or transitively), the command stops immediately with an error rather than looping forever. Sibling packages — entries already being processed at the same level — are also skipped to prevent double-processing.

## CLI reference

```
Usage:
  npx filedist [init|install|check|list|remove|update] [options]

Commands:
  init      Set up publishing configuration in a package
  install   Extract files from a published package into a local directory (alias: extract)
  check     Verify local files are in sync with the lockfile (reads .filedist.lock)
  list      List all files managed by filedist in an output directory
  remove    Remove a package set from config and delete its managed files (reads .filedist.yml)
  update    Bump packages to latest versions, update lockfile, and re-extract

Global options:
  --help, -h       Show help
  --version        Show version

Init options:
  --files <patterns>       Comma-separated glob patterns of files to publish
                           e.g. "docs/**,data/**,configs/*.json"
  --packages <specs>       Comma-separated additional package specs to bundle as data sources.
                           Each spec is "name" or "name@version", e.g.
                           "shared-configs@^1.0.0,base-templates@2.x".
                           Added to `dependencies` so consumers pull data from all of them.
  --output, -o <dir>       Directory to scaffold into (default: current directory)

Extract options:
  --packages <specs>       Comma-separated package specs.
                           When omitted, filedist searches for a configuration file
                           (.filedist.yml) and runs all
                           entries defined there.
                           Each spec is `name`, `name@version`, `npm:name@version`, or
                           `git:github.com/org/repo.git@ref`, e.g.
                           "my-pkg@^1.0.0,git:github.com/org/repo.git@main"
  --output, -o <dir>       Output directory (default: current directory)
  --force                  Overwrite existing files or files owned by a different package
  --mutable                Skip files that already exist; mark extracted files as mutable (check ignores
                           content changes). Cannot be combined with --force
  --gitignore [bool]       Disable .gitignore management when set to false (enabled by default)
  --managed [bool]         Set to false to write files without a .filedist marker, .gitignore
                           update, or read-only flag. Existing files are skipped. Files can be
                           freely edited afterwards and are not tracked by filedist.
  --files <patterns>       Comma-separated glob patterns to filter files
  --content-regex <regex>  Regex to filter files by content
  --dry-run                Preview changes without writing any files
  --upgrade                Reinstall the package even if already present
  --silent                 Print only the final result line, suppressing per-file output
  --verbose, -v            Print detailed progress information for each step
  --no-save                Skip loading and updating the local .filedist.yml config file.
                           By default, when --packages is provided the run is saved to
                           .filedist.yml so future `filedist install` calls (without
                           --packages) reuse the same config automatically.
  --frozen-lockfile        Use .filedist.lock exclusively; fail if the lock file does not
                           exist. Does not update the lock file.

Check options:
  (no extra options — reads exclusively from .filedist.lock)
  --local-only             Skip package install; verify only file checksums from .filedist markers
  --verbose, -v            Print detailed progress information

Update options:
  --dry-run                Preview changes without writing any files
  --verbose, -v            Print detailed progress information

Remove options:
  <package>                Package name to remove (version/ref is ignored during matching)
  --output, -o <dir>       Only remove entries whose output.path equals this value
  --all                    Remove every set entry from the config
  --dry-run                Preview changes without modifying config or disk
  --config <file>          Path to a config file (overrides default .filedist.yml)
  --silent                 Suppress per-file output
  --verbose, -v            Print detailed progress information

List options:
  --output, -o <dir>       Output directory to inspect (default: current directory)
```

## Library usage

`filedist` also exports a programmatic API:

```typescript
import { actionInstall, actionCheck, actionList, actionRemove, actionUpdate } from 'filedist';
import type { FiledistExtractEntry, ProgressEvent } from 'filedist';

const entries: FiledistExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
];
const cwd = process.cwd();

// extract files
const result = await actionInstall({ entries, cwd });
console.log(result.added, result.modified, result.deleted);

// dry-run: preview changes without writing files
const dryResult = await actionInstall({ entries: entries.map(e => ({ ...e, output: { ...e.output, dryRun: true } })), cwd });
console.log('Would add', dryResult.added, 'files');

// track progress file-by-file
await actionInstall({
  entries,
  cwd,
  onProgress: (event: ProgressEvent) => {
    if (event.type === 'file-added')    console.log('A', event.file);
    if (event.type === 'file-modified') console.log('M', event.file);
    if (event.type === 'file-deleted')  console.log('D', event.file);
  },
});

// use frozen lockfile (reads .filedist.lock, fails if missing, does not update it)
const frozenResult = await actionInstall({ entries, cwd, frozenLockfile: true });
console.log(frozenResult.added, frozenResult.modified);

// check sync status (reads .filedist.lock; pass entries:[] to let lockfile drive)
const summary = await actionCheck({ entries: [], cwd, frozenLockfile: true });
const hasDrift = summary.missing.length > 0 || summary.modified.length > 0 || summary.extra.length > 0;
if (hasDrift) {
  console.log('Missing:', summary.missing);
  console.log('Modified:', summary.modified);
  console.log('Extra:', summary.extra);
}

// remove a specific package set from config and delete its managed files
const removeResult = await actionRemove({ cwd, packageSpec: 'my-shared-assets' });
console.log('Removed entries:', removeResult.removedEntries, 'deleted files:', removeResult.install.deleted);

// remove all sets from config (clears all managed files)
await actionRemove({ cwd, all: true });

// update all packages to latest versions
const updateResult = await actionUpdate({ cwd });
console.log('Updated:', updateResult.added, 'added,', updateResult.modified, 'modified,', updateResult.deleted, 'deleted');

// list all files managed by filedist in an output directory
const managed = await actionList({ entries, config: null, cwd });
// ManagedFileMetadata[]: Array<{ path: string; packageName: string; packageVersion: string }>
```

### `ProgressEvent` type

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end';   packageName: string; packageVersion: string }
  | { type: 'file-added';    packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted';  packageName: string; file: string }
  | { type: 'file-skipped';  packageName: string; file: string };
```

### `postExtractCmd`

Set `postExtractCmd` at the top level of your config to run a command after a successful non-dry-run `extract`.
Use an argv array such as `["node", "scripts/post-extract.js"]`; shell strings are rejected so common quoting mistakes fail clearly.

See the root [README.md](../README.md) for the full documentation.

## Lock file

Each `install` run writes a `.filedist.lock` file in the working directory that records:

- **`packages`** — the exact resolved version for every package in the dependency graph
- **`sets`** — the full entry definitions (package specs, selectors, output paths) that were used for this install
- **`managed_files`** — the list of all files managed after the install

```json
{
  "lockfileVersion": 1,
  "packages": {
    "my-shared-assets": { "source": "npm", "spec": "my-shared-assets", "resolvedVersion": "2.3.1" },
    "git:github.com/org/repo.git@main": { "source": "git", "spec": "git:github.com/org/repo.git@main", "resolvedVersion": "abc123def456" }
  },
  "sets": [
    { "package": "my-shared-assets@^2.0.0", "output": { "path": "./data" } }
  ],
  "managed_files": ["data/user1.json", "data/configs/app.config.json"]
}
```

This file makes installs **reproducible** — even if a newer version of a package is published between runs, repeating `install` will fetch exactly the versions that were used the first time.

`check` reads **exclusively from `.filedist.lock`** (using the `sets` stored there) and does not read your `.filedist.yml` configuration. This ensures it always operates on the same entry definitions that were used during install, regardless of any local config changes.

When `--frozen-lockfile` is passed to `install`, it also validates that the current managed files match the list stored in the lockfile, failing if they differ.

### `--frozen-lockfile`

Pass `--frozen-lockfile` to enforce that the lock file is used as-is without any resolution or update:

```sh
# use exactly the versions from .filedist.lock, fail if it does not exist
npx filedist install --frozen-lockfile
```

Behaviour:
- Reads `.filedist.lock` and pins every package to its recorded version.
- Fails immediately if `.filedist.lock` does not exist.
- Does **not** write or update `.filedist.lock`.

### Commit `.filedist.lock`

Commit `.filedist.lock` alongside `.filedist.yml` so that everyone on the team and all CI jobs install identical file versions.

---

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.filedist` marker file in each output directory. On subsequent extractions:

- Unchanged files are skipped.
- Updated files are overwritten.
- Files removed from the package are deleted locally.

The marker file uses a `|`-delimited format; files written by older versions of `filedist` using the comma-delimited format are read correctly for backward compatibility.

Multiple packages can coexist in the same output directory; each owns its own files.

## Developer Notes

### Module overview

| Folder / file | Purpose |
|---|---|
| `src/cli/` | CLI entry-points: argument parsing, help text, config loading, per-command handlers |
| `src/package/` | Package-level orchestration: config resolution, fileset iteration, and init coordination |
| `src/fileset/` | File-level extraction, diff, check, and sync logic |
| `src/types.ts` | Shared TypeScript types |
| `src/utils.ts` | Low-level utilities: package install, glob/hash helpers, package manager detection |
| `src/index.ts` | Public API surface |

### Marker file (`.filedist`)

Each output directory that contains managed files gets a `.filedist` CSV file. Columns: `path`, `packageName`, `packageVersion` — one row per file, no header. This is the source of truth for ownership tracking and clean removal.

### Key design decisions

- File identity is tracked by path + hash, not by timestamp, to be deterministic across machines.
- Extract uses a two-phase diff + execute model: compute all changes first, then apply them, enabling conflict detection and rollback before any file is written.
- The bin shim generated by `filedist init` contains no logic; all behaviour is versioned inside this library.

### Dev workflow

```
make build lint-fix test
```

This maintainer workflow uses `make` and a bash-compatible shell. On Windows, use WSL or run the equivalent `pnpm` commands inside `lib/` directly.
