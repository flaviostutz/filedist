# cli-config

This example demonstrates using **filedist** via a local configuration file rather than passing
`--packages` on every command. It shows that `filedist extract`, `filedist check`, and `filedist purge`
all work without `--packages` when a configuration is detected automatically.

## How it works

When `--packages` is omitted from an `extract`, `check`, or `purge` command, the `filedist` CLI
searches for a configuration using [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) in the
following order (starting from the current working directory):

| Location | Format |
|---|---|
| `package.json` → `"filedist"` key | JSON object with `"sets"` array |
| `.filedistrc` | JSON or YAML object with `"sets"` array |
| `.filedistrc.json` | JSON object with `"sets"` array |
| `.filedistrc.yaml` / `.filedistrc.yml` | YAML object with `"sets"` array |
| `filedist.config.js` | CommonJS module exporting object with `sets` array |

Each entry in the `sets` array supports the same fields as a data-package `"filedist.sets"` array entry.

## Configuration approaches

### Option A – package.json

```json
{
  "name": "my-project",
  "filedist": {
    "sets": [
      {
        "package": "example-files-package",
        "outputDir": "output",
        "files": ["docs/**", "data/**"]
      }
    ]
  }
}
```

### Option B – .filedistrc

```json
{
  "sets": [
    {
      "package": "example-files-package",
      "outputDir": "output",
      "files": ["docs/**", "data/**"]
    }
  ]
}
```

## Running the example

```bash
# installs dependencies (requires mypackage/ to be built first)
make install

# extracts files – no --packages argument needed
pnpm exec filedist extract

# verifies local files are in sync
pnpm exec filedist check

# removes all managed files
pnpm exec filedist purge

# lists all preset tags defined in the configuration
pnpm exec filedist presets
```

## Presets

Entries can be tagged with `presets` so that only a subset is processed when `--presets` is given:

```json
{
  "sets": [
    { "package": "example-files-package", "presets": ["basic"], "output": { "path": "output" } },
    { "package": "eslint@8",              "presets": ["extra"],  "output": { "path": "output/eslint", "managed": false } }
  ]
}
```

```bash
# list available preset tags
pnpm exec filedist presets
# → basic
# → extra

# extract only "basic"-tagged entries
pnpm exec filedist extract --presets basic

# check only "basic"-tagged entries
pnpm exec filedist check --presets basic
```

> **`presets` vs `selector.presets`**
>
> - **`sets[].presets`** — tags **this entry**. When a consumer runs `--presets basic`, only entries
>   tagged `basic` are processed. This is what `filedist presets` lists.
>
> - **`sets[].selector.presets`** — filters which of the **target package's own** `filedist.sets` are
>   recursively extracted. If `example-files-package` itself has an `filedist.sets` array with its own
>   preset tags, you can control which of those inner sets are pulled by setting `selector.presets` on
>   the entry that references it.

## Running the integration test

```bash
make test
```

This runs the full test cycle twice – once reading the configuration from `package.json` and once
from a temporary `.filedistrc` file – to verify that both configuration sources work correctly.

## Entry format reference

Each entry supports the same fields as a data-package `"filedist.sets"` array entry:

| Field | Type | Description |
|---|---|---|
| `package` | `string` | Package name/spec to extract from (e.g. `"my-pkg"` or `"my-pkg@^1.0.0"`) |
| `outputDir` | `string` | Directory to extract files into (relative to cwd) |
| `files` | `string[]` | Glob patterns to filter which files are extracted |
| `tags` | `string[]` | Optional tags for filtering with `--tags` |
| `force` | `boolean` | Overwrite existing files |
| `keepExisting` | `boolean` | Skip files that already exist |
| `gitignore` | `boolean` | Manage `.gitignore` (default: `true`) |
| `managed` | `boolean` | Write with `.filedist` marker (default: `true`). Set to `false` to skip tracking |
| `dryRun` | `boolean` | Simulate without writing |
| `silent` | `boolean` | Suppress per-file output |
| `verbose` | `boolean` | Print detailed progress |
