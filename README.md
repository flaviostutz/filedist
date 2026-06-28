# filedist

Publish folders as npm packages or git repositories and extract them in any workspace. Distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry or directly from git.

## Getting Started

### CLI

```sh
# extract files from any npm package into a local directory
npx filedist install my-shared-assets --output ./data

# extract directly from git
npx filedist install git:github.com/flaviostutz/xdrs-core --output ./xdrs

# extract directly from a local directory
npx filedist install file:///path/to/local-folder --output ./data
```

If you want to syncronise later with the latest versions of the files published in npm or git, run

```sh
# will read lock file, upgrade with latest versions and extract more recent files
npx filedist update
```

You can change file .filedist.yml to tweak how installation is performed, then run to update the extracted files to the new configuration

```sh
npx filedist install
```

## Lib

```typescript
import { actionInstall } from 'filedist';
import type { FiledistExtractEntry } from 'filedist';

const entries: FiledistExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
  {
    package: 'git:github.com/flaviostutz/xdrs-core@1.3.0',
    output: { path: './xdrs' },
  },
];
const result = await actionInstall({ entries, cwd: process.cwd() });
console.log(result.added, result.modified, result.deleted);
```

Package specs support optional source prefixes. Use `git:` for git repositories and `npm:` when you want to make the npm source explicit. When no prefix is present, filedist treats the spec as npm. Git specs accept full repository URLs and host/path shorthands such as `git:github.com/org/repo.git@ref`. Use `file://` to extract from a local directory on disk — relative paths (`file://./relative/dir`) and absolute paths (`file:///absolute/path`) are both supported.

---

## Guides

- [How to share dataset files with filedist](docs/share-dataset-files-with-filedist.md)

---

## How it works

- **Publisher**: a project, npm package, or plain git repository whose folders you want to share. Running `init` prepares its `package.json` so those folders are included when published.
- **Consumer**: any project that installs that package and runs `install` to pull the files locally. A `.filedist` marker file tracks ownership and enables safe updates.

Publishers can also carry their own `filedist` config in `.filedist-package.yml`, including `sets` entries. That works the same whether the publisher is consumed from npm or directly from git.

---

## Scenario 1 — Ad-hoc CLI extraction

Pull files directly without any setup:

```sh
# npm package examples
npx filedist install my-shared-assets@^2.0.0 --output ./data
npx filedist install my-shared-assets --files "**/*.md" --output ./docs
npx filedist install my-shared-assets --content-regex "env: production" --output ./configs
npx filedist install my-shared-assets --output ./data --dry-run

# git source examples
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --files "docs/**/*.md" --output ./docs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --content-regex "Decision Outcome" --output ./filtered-docs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --dry-run

# local directory examples
npx filedist install file:///path/to/local-folder --output ./data
npx filedist install file://./relative/local-folder --files "**/*.md" --output ./docs
npx filedist install file:///path/to/local-folder --output ./data --dry-run
```

---

## Scenario 2 — Config file in your project

Declare sources in `.filedist.yml` and run `install` without a package argument:

```yaml
# .filedist.yml
defaultPresets:
  - prod
sets:
  - package: "base-datasets@^3.0.0"
    selector:
      files:
        - datasets/**
    output:
      path: ./data
  - package: "org-templates@^1.2.0"
    selector:
      files:
        - templates/**
    output:
      path: ./templates
  - package: "git:github.com/flaviostutz/xdrs-core@1.3.0"
    selector:
      files:
        - docs/**
    output:
      path: ./xdrs
  - package: "git:file:///absolute/path/to/local-repo@v2.0.0"
    selector:
      files:
        - conf/**
    output:
      path: ./local-conf
  - package: "file:///absolute/path/to/local-folder"
    selector:
      files:
        - assets/**
    output:
      path: ./local-assets
```

For a local git repository, use the `git:file://` form. For a plain local directory (no git), use `file://` directly (`file://./relative/path` or `file:///absolute/path`). For a local Windows path with git, use `git:file:///C:/work/local-repo@v2.0.0`.

```sh
npx filedist install   # reads config, extracts all sets or only defaultPresets when defined
npx filedist check     # verifies files are in sync using .filedist.lock (no config needed)
npx filedist update    # bumps packages to latest, updates lockfile, and re-extracts
```

After `install`, the output directory will contain the selected files alongside a `.filedist` marker file that tracks ownership and enables safe updates:

```
./data/
  datasets/
    sample.csv
    labels.csv
  .filedist              ← tracks file ownership (package name + version)
```

Config is loaded from `.filedist.yml` in the current directory by default. Pass `--config <file>` to use a different file instead.

When `defaultPresets` is defined at the root of the config, `install` and `check` behave the same as if `--presets <tags>` had been passed. An explicit `--presets` flag overrides the configured default for that invocation.
Use `--all` to ignore `defaultPresets` for one command and process every configured entry.

The same config file can mix npm packages and git repositories. Use the `git:` prefix for git entries. A git repository source can also provide its own `.filedist-package.yml` with `sets`, and those nested sets participate in the same hierarchical resolution.

### Example — Prepare a git repository source

If you want a plain git repository to behave like a publisher, put the files you want to expose in the repo and add a root `.filedist-package.yml` describing its own files and any nested upstream sources:

```text
shared-assets-repo/
  .filedist-package.yml
  docs/
    README.md
  data/
    users-dataset/
  configs/
    app.json
```

.filedist-package.yml
```yaml
sets:
  - selector:
      files:
        - docs/**
        - data/**
    output:
      path: .
    presets:
      - base
  - selector:
      files:
        - configs/**
    output:
      path: ./conf
    presets:
      - runtime
  - package: "git:github.com/my-org/shared-policies@v1.4.0"
    selector:
      files:
        - policies/**
    output:
      path: ./vendor/policies
    presets:
      - runtime
```

Commit and tag that repository, then consume it like any other source:

```sh
npx filedist install git:github.com/my-org/shared-assets-repo@v1.0.0 --output ./assets
npx filedist install git:github.com/my-org/shared-assets-repo@v1.0.0 --output ./assets --presets runtime
```

In this setup, filedist clones the repository, reads the root `.filedist-package.yml`, extracts the repo's own files from the self entries that omit `package`, and then follows any external `sets` entries recursively.

---

## Scenario 3 — Data package (curated bundle for consumers)

A data package bundles, filters, and versions content from multiple upstream sources. Consumers install it and run one command — no knowledge of the internals required.

**Step 1 — Create the data package**

```sh
# in the data package directory
pnpm dlx filedist init --files "docs/**,data/**"
```

`init` updates `package.json` with the right `files`, `bin`, and `dependencies`, writes a `bin/filedist.js` entry point, and generates a `.filedist-package.yml` with a single self entry for the local files.

To also pull from upstream npm packages or git repositories, add additional entries manually to `.filedist-package.yml` after running `init`:

```yaml
# .filedist-package.yml
sets:
  - output:
      path: .
    selector:
      files:
        - docs/**
        - data/**
  # Add upstream sources manually:
  - package: "shared-configs@^1.0.0"
    output:
      path: .
  - package: "git:github.com/flaviostutz/xdrs-core@1.3.0"
    output:
      path: .
```

Then:

```sh
npm publish
```

**Step 2 — Extend `.filedist-package.yml` with upstream sources**

To pull from additional upstream npm packages or git repositories, add entries to `.filedist-package.yml` (generated by `init`):

```yaml
# .filedist-package.yml
sets:
  - selector:
      files:
        - docs/**
        - data/**
    output:
      path: .
    presets:
      - prod
  - package: "base-datasets@^3.0.0"
    selector:
      files:
        - datasets/**
    output:
      path: ./data/base
    presets:
      - prod
  - package: "org-configs@^1.2.0"
    selector:
      contentRegexes:
        - "env: production"
      presets:
        - reports
    output:
      path: ./configs
    presets:
      - prod
      - staging
  - package: "git:github.com/flaviostutz/xdrs-core@1.3.0"
    selector:
      files:
        - docs/**
    output:
      path: ./xdrs
    presets:
      - prod
```

In a package's own sets, omit `package` to mean "extract files from this package itself". Use `package` only for external dependencies.

> **`presets` vs `selector.presets`**
> - `sets[].presets` — tags **this entry** so it is only processed when `--presets <tag>` matches. Use this in a consumer config to pick which source packages to extract.
> - `sets[].selector.presets` — filters which of the **target package's own** `filedist.sets` are recursively extracted. Only the nested sets inside the target package whose `presets` fields match will run.

**Step 3 — Consumer installs and runs**

```sh
# Extract all files from this curated package to current dir
npx my-org-configs extract

# limit to a preset
npx my-org-configs extract --output ./local-data --presets prod
```

---

## All install options

```sh
npx filedist install my-pkg@^2.0.0 --output ./data              # specific version
npx filedist install my-pkg --output ./data --force              # overwrite existing files
npx filedist install my-pkg --output ./data --managed=false      # skip tracking
npx filedist install my-pkg@latest --output ./data --upgrade     # force reinstall
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --force        # overwrite existing files
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --managed=false # skip tracking
npx filedist install git:github.com/flaviostutz/xdrs-core@main --output ./xdrs --upgrade        # force a fresh clone/check-out
npx filedist install my-pkg --output ./data --gitignore=false    # skip .gitignore
npx filedist install my-pkg --output ./data --dry-run            # preview only
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --gitignore=false  # skip .gitignore
npx filedist install git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --dry-run          # preview only
npx filedist install my-pkg --output ./data --nosync             # keep stale managed files on disk
npx filedist install my-pkg --output ./data --frozen-lockfile    # use .filedist.lock exclusively
npx filedist install file:///path/to/local-folder --output ./data              # local directory
npx filedist install file://./relative/local-folder --output ./data --force   # local directory, overwrite
npx filedist install file:///path/to/local-folder --output ./data --dry-run   # local directory, preview
# For multiple packages, use a config file (.filedist.yml) and run: npx filedist install
```

`install` logs every file change:
```
  + data/users-dataset/user1.json (M,I)
  ~ data/configs/app.config.json (M,I)
  - data/old-file.json
```

---

## Check, list, and presets

`check` and `install` are all **hierarchy-aware**: when a target package carries its own `filedist.sets` block, the command automatically recurses into those transitive dependencies. See [Hierarchical package resolution](#hierarchical-package-resolution) for the full details.

```sh
# verify files are in sync against .filedist.lock (exit 0 = ok, exit 1 = drift or error)
npx filedist check

# use --local-only to skip package downloads (offline/CI)
npx filedist check --local-only

# list all managed files grouped by package
npx filedist list --output ./data

# list all preset tags defined in your configuration
npx filedist presets
```

In config-file mode you can define a root-level `defaultPresets` array so `install` and `check` automatically run the same filtered subset without requiring `--presets` every time.
Use `--all` when you want to bypass that default and process the full configured set.

---

## Entry options reference

Each entry in `filedist.sets` supports:

| Option | Type | Default | Description |
|---|---|---|---|
| `package` | `string` | none | Source spec for external entries: npm (`my-pkg`, `npm:my-pkg@^1.2.3`), git (`git:github.com/org/repo.git@ref`, `git:file:///tmp/repo@main`, `git:file:///C:/tmp/repo@main`), or local directory (`file:///absolute/path`, `file://./relative/path`) |
| `presets` | `string[]` | none | Tags this entry so it is included only when the matching `--presets <tag>` flag is used. Listed by `filedist presets` |
| `output.path` | `string` | `.` (cwd) | Extraction directory, relative to where the command runs |
| `selector.files` | `string[]` | all files | Glob patterns to filter extracted files |
| `selector.basedir` | `string` | package root | Subdirectory within the package to use as the enumeration root. Glob patterns in `selector.files` are matched relative to this subdirectory, and extracted files preserve their path relative to it (the `basedir` prefix is stripped from the destination). `output.path` is unaffected. Defaults to the package root |
| `selector.contentRegexes` | `string[]` | none | Regex patterns to filter files by content |
| `selector.exclude` | `string[]` | none | Glob patterns to exclude files even if they match `selector.files` |
| `selector.presets` | `string[]` | none | Filters which of the **target package's own** `filedist.sets` are recursively extracted. Only sets in the target whose `presets` matches are processed. Does not affect which files are selected from the target package itself |
| `selector.upgrade` | `boolean` | `false` | Force fresh package install even if a satisfying version is already installed |
| `output.force` | `boolean` | `false` | Overwrite unmanaged or foreign-owned files |
| `output.mutable` | `boolean` | `false` | Skip files that already exist; mark extracted files as mutable (check ignores content changes) |
| `output.noSync` | `boolean` | `false` | Keep stale managed files on disk during extract instead of deleting them. `check` still reports them as extra drift until they are removed or synced |
| `output.gitignore` | `boolean` | `true` | Write `.gitignore` alongside managed files |
| `output.managed` | `boolean` | `true` | Write files with tracking (marker). Set to `false` to skip tracking |
| `output.readonly` | `boolean` | `false` | Set extracted files to read-only (0o444) on disk |
| `output.dryRun` | `boolean` | `false` | Simulate without writing |
| `output.symlinks` | `SymlinkConfig[]` | none | Post-extract symlink operations |
| `output.contentReplacements` | `ContentReplacementConfig[]` | none | Post-extract content replacements |

Top-level config fields:

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultPresets` | `string[]` | none | CLI-only fallback for config-file mode. `install` and `check` behave as if `--presets <tags>` had been passed when the flag is omitted |
| `postExtractCmd` | `string[]` | none | Command argv run after a successful non-dry-run `install`. The first array item is the executable and the remaining items are its arguments. Full install argv is appended |

### SymlinkConfig

Creates symlinks after extraction. Stale symlinks pointing into `output.path` are removed automatically.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Glob relative to `output.path` |
| `target` | `string` | Directory for symlinks, relative to project root |

### ContentReplacementConfig

Applies regex replacements to workspace files after extraction.

| Field | Type | Description |
|---|---|---|
| `files` | `string` | Glob selecting files to modify |
| `match` | `string` | Regex locating the text to replace |
| `replace` | `string` | Replacement string (supports `$1` back-references) |

---

## Hierarchical package resolution

`install` and `check` are all hierarchy-aware: when a target package or git repository carries its own `.filedist-package.yml` with `sets`, the command automatically recurses into those transitive dependencies.

This lets you build layered data package chains:

```
consumer project
  └─ my-org-configs          (npm package with filedist.sets)
       ├─ base-datasets       (another npm package with its own files)
       └─ org-templates       (another npm package with its own files)
            └─ raw-assets     (leaf package)
```

Running `npx filedist install my-org-configs --output ./data` extracts files from every package in the chain, not just `my-org-configs` itself. Running `check` (reads from `.filedist.lock`) verifies that exact set of files.

For git sources, filedist clones each repository into `.filedist-tmp` under the working directory, adds that path to `.gitignore` if needed, reads nested `filedist` config from the cloned repository, and removes `.filedist-tmp` after the command finishes.

### Output path resolution

Each level’s `output.path` is resolved relative to the caller’s own `output.path`. A package at depth 1 with `output.path: "./configs"` that has a transitive dependency with `output.path: "./shared"` will land at `./configs/shared`.

### Caller overrides (install only)

When `install` recurses, the calling entry's `output` flags are inherited by every transitive dependency, with caller-defined values always winning:

| Caller sets | Effect on transitive entries |
|---|---|
| `force: true` | Transitive entries also overwrite unmanaged / foreign files |
| `dryRun: true` | No files are written anywhere in the hierarchy |
| `mutable: true` | Existing files are skipped at every level; extracted files are marked as mutable |
| `gitignore: false` | No `.gitignore` entries are created anywhere |
| `managed: false` | All transitive files are written without a marker or read-only flag |
| `symlinks` / `contentReplacements` | Appended to each transitive entry’s own lists |

Settings that are undefined on the caller are left as-is so the transitive package’s own defaults apply.
### Scoping file selection with `selector.basedir`

Set `selector.basedir` on an entry (or in a package's own self-set) to start file enumeration from a subdirectory of the package instead of the package root. Glob patterns in `selector.files` and returned relative paths are relative to that subdirectory. The output path mirrors the structure under `basedir`, not under the full package root.

```yaml
sets:
  - package: "my-shared-assets@^2.0.0"
    selector:
      basedir: packagedir
      files:
        - manual/**
    output:
      path: pkginstalled
      gitignore: false
```

In this example, files under `<package-root>/packagedir/manual/` are selected. The `packagedir` prefix is stripped, so `manual/guide.md` (relative to `packagedir/`) is written to `pkginstalled/manual/guide.md` in the consuming project. `output.path` (`pkginstalled`) is always relative to the directory where the command is run, not to `basedir`.
### Filtering transitive sets with `selector.presets`

Set `selector.presets` on an entry to control which sets inside the target package are recursed into (applies to `install` and `check`). Only sets whose `presets` tag overlaps with the filter are processed; sets with no `presets` are skipped when a filter is active.

```json
{
  "filedist": {
    "sets": [
      {
        "package": "my-org-configs@^2.0.0",
        "output": { "path": "./data" },
        "selector": { "presets": ["prod"] }
      }
    ]
  }
}
```

### Circular dependency detection

If a package chain references itself, the command stops immediately with an error. Sibling packages — entries already being processed at the same level — are also skipped to prevent double-processing.

---

## CLI reference

```
Usage: filedist [command] [options]

Commands:
  install (default)  Install files from npm packages; writes .filedist.lock
  update             Bump packages to latest versions; re-installs and updates lock file
  remove             Remove a package from config and delete its managed files
  check              Verify installed files match the pinned state in .filedist.lock
  list               List all managed files
  init               Scaffold a publishable data package
  presets            List all preset tags defined in configuration

Install:  [<package>]           Package spec to add/install (positional; omit to use config file)
          --output, -o <dir>    Output directory (default: cwd)
          --files <patterns>    Filter files by glob
          --content-regex <rx>  Filter files by content
          --force               Overwrite existing/foreign files
          --mutable             Skip existing files; mark extracted files as mutable (check ignores content changes)
          --gitignore [bool]    Disable .gitignore management when set to false
          --managed [bool]      Write without tracking when set to false
          --dry-run             Preview without writing
          --upgrade             Reinstall even if present
          --nosync [bool]       Keep stale managed files on disk when set to true
          --frozen-lockfile     Use .filedist.lock exclusively; fail if missing
          --presets <tags>      Only process entries matching these preset tags
          --all                 Ignore config defaultPresets and process all configured entries
          --no-save             Skip saving positional package to .filedist.yml
          --config <file>       Explicit config file path (overrides auto-discovery)
          --verbose, -v         Detailed progress output
          --silent              Final result line only

Update:   --dry-run             Preview without writing
          --verbose, -v         Detailed progress output
          --silent              Final result line only

Remove:   <package>             Package name to remove (version/ref is ignored during matching)
          --output, -o <dir>    Restrict removal to entries matching this output path
          --dry-run             Preview without writing
          --config <file>       Explicit config file path (overrides auto-discovery)
          --verbose, -v         Detailed progress output
          --silent              Final result line only

Check:    --local-only          Verify only against .filedist markers; skip package downloads
          --verbose, -v         Detailed comparison output

List:     --output, -o <dir>    Directory to inspect
          --config <file>       Explicit config file path (overrides auto-discovery)

Presets:  --config <file>       Explicit config file path (overrides auto-discovery)
                                Lists all preset tags defined in configuration,
                                sorted alphabetically, one per line

Init:     --files <patterns>           Glob patterns of files to publish
          --output, -o <dir>           Directory to scaffold into (default: cwd)
          --package-config <file>      Config filename embedded in bin/filedist.js (default: .filedist.yml)
```

---

## Programmatic API

```typescript
import { actionInstall, actionCheck, actionList, actionRemove, actionUpdate } from 'filedist';
import type { FiledistExtractEntry, ProgressEvent } from 'filedist';
import path from 'node:path';

const entries: FiledistExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
];
const cwd = process.cwd();

// extract files (resolves and locks versions into .filedist.lock)
const result = await actionInstall({ entries, cwd });
console.log(result.added, result.modified, result.deleted);

// reproducible install: use exact versions from .filedist.lock (fails if missing)
const frozenResult = await actionInstall({ entries, cwd, frozenLockfile: true });
console.log(frozenResult.added, frozenResult.modified);

// track progress
await actionInstall({
  entries,
  cwd,
  onProgress: (event: ProgressEvent) => {
    if (event.type === 'file-added')    console.log('+', event.file);
    if (event.type === 'file-modified') console.log('~', event.file);
    if (event.type === 'file-deleted')  console.log('-', event.file);
  },
});

// check sync status (reads from .filedist.lock)
const lockfilePath = '.filedist.lock';
const summary = await actionCheck({ entries: [], cwd, lockfilePath, frozenLockfile: true });
const hasDrift = summary.missing.length > 0 || summary.conflict.length > 0 || summary.extra.length > 0;
if (hasDrift) {
  console.log('Missing:', summary.missing);
  console.log('Conflict:', summary.conflict);
  console.log('Extra:', summary.extra);
}

// remove a package set from config and delete its managed files
await actionRemove({
  cwd,
  packageSpec: 'my-shared-assets',
  configFilePath: path.join(cwd, '.filedist.yml'),
  lockfilePath: path.join(cwd, '.filedist.lock'),
});

// update all packages to latest versions and re-extract
const updateResult = await actionUpdate({ cwd });
console.log(updateResult.added, updateResult.modified, updateResult.deleted);

// list managed files
const managed = await actionList({ entries, config: null, cwd });
// ManagedFileMetadata[]: Array<{ path: string; packageName: string; packageVersion: string }>
```

### ProgressEvent

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end';   packageName: string; packageVersion: string }
  | { type: 'file-added';    packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted';  packageName: string; file: string }
  | { type: 'file-skipped';  packageName: string; file: string };
```

### postExtractCmd

Set `postExtractCmd` at the top level of your config to run a command after a successful (non-dry-run) `install`. Use an array so the executable and its arguments are passed directly without a shell. The full argv of the install call is appended automatically.

`postExtractCmd` must be an argv array. Shell strings such as `"node scripts/post-extract.js"` are rejected with a configuration error because they are a common source of mistakes.

```json
{
  "filedist": {
    "postExtractCmd": ["node", "scripts/post-extract.js"],
    "sets": []
  }
}
```

### defaultPresets

Set `defaultPresets` at the top level of your config to make `install` and `check` default to the same preset filter you would otherwise pass through `--presets`.

```json
{
  "filedist": {
    "defaultPresets": ["prod", "reports"],
    "sets": []
  }
}
```

Running `npx filedist install` with that config behaves the same as `npx filedist install --presets prod,reports`. Passing `--presets` explicitly overrides `defaultPresets` for that command.

---

## Lock file

Each `install` run writes a `.filedist.lock` file in the working directory recording the exact resolved version for every package in the full dependency graph, including transitive sub-packages declared in nested `filedist.sets` blocks.

```json
{
  "lockfileVersion": 1,
  "packages": {
    "my-shared-assets": { "source": "npm", "spec": "my-shared-assets", "resolvedVersion": "2.3.1" },
    "git:github.com/org/repo.git@main": { "source": "git", "spec": "git:github.com/org/repo.git@main", "resolvedVersion": "abc123def456" }
  }
}
```

### `--frozen-lockfile`

Pass `--frozen-lockfile` to pin every package to the version recorded in `.filedist.lock`:

```sh
# reproducible install — uses exact versions from .filedist.lock
npx filedist install --frozen-lockfile
```

- Fails immediately if `.filedist.lock` does not exist.
- Does **not** update the lock file.

Commit `.filedist.lock` alongside your config file so all team members install identical versions.

---

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.filedist` marker file per output directory. On subsequent extractions, unchanged files are skipped, updated files are overwritten, and files removed from the package are deleted locally. Multiple packages can coexist in the same output directory — each owns its files.

See [examples/](examples/) for working samples.
