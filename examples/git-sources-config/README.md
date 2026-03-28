# git-sources-config

This example exercises `filedist` in config-file mode when the source package is a git repository.
It creates a local tagged parent repository, configures that repository to recursively extract a tagged
child repository via `.filedistrc`, and then validates the flow with both configuration sources that the
CLI auto-discovers:

- `package.json` → `filedist` key
- `.filedistrc`

## What it verifies

- git package specs are resolved from a local `file://` repository URL
- nested `.filedistrc` inside a cloned git repository is loaded recursively
- extracted files land in separate output roots with separate `.filedist` markers
- git metadata and `.filedistrc` files are not copied into the output
- `check` and `purge` work without passing `--packages`

## Running the integration test

```bash
make test
```

The Makefile generates fresh local git repositories under `repos/`, tags them, patches `package.json`
with the correct absolute `file://` URL for the parent repository, and then runs the same extraction
cycle once from `package.json` config and once from `.filedistrc` config.