# some-project-consuming-package

This is an example **consumer** project. It installs `mypackage` (the sibling publisher example) and uses its built-in bin script to extract shared files into the local workspace.

## How it works

`mypackage` was prepared with `filedist init`, so it ships a `bin/filedist.js` entry point. After installing the package, consumers can call that script directly — no separate `filedist` invocation needed. That packaged CLI reads the publisher package's own `filedist.sets`, including package-less self entries and any external dependency entries:

```sh
# extract only docs files (.gitignore entries are written by default)
pnpm exec mypackage extract --files "docs/**/*"

# extract without writing .gitignore entries
pnpm exec mypackage extract --files "docs/**/*" --gitignore=false

# preview what would change before writing anything
pnpm exec mypackage extract --files "docs/**/*" --dry-run

# check whether local files are still in sync with the published package
pnpm exec mypackage check
```

Alternatively, use `filedist` directly and point it at the installed package:

```sh
pnpm exec filedist install mypackage --files "docs/**/*"
pnpm exec filedist list
```

## Running the example

These `make` targets are maintainer integration workflows and require a bash-compatible environment such as macOS, Linux, or WSL/Git Bash on Windows.

```sh
# install the package and extract the shared files
make build
```

```sh
# full integration test: clean → install → extract → verify
make test
```

`make test` installs `mypackage` from the locally built tarball, extracts the shared files, and then asserts the expected files are present on disk.

## Publisher side

See [`../mypackage/README.md`](../mypackage/README.md) for how `mypackage` is built and published.
