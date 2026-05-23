# cli-config-simple

Demonstrates the full version lifecycle of extracting files from public npm packages using a `.filedist.yml` config file.

## What this example covers

| Exercise | Description |
|---|---|
| 1 | Install with old **pinned** versions (`eslint@8.0.0`, `chalk@4.0.0`) and assert output files |
| 2 | Run `check` to validate all tracked files match the lock |
| 3 | **Bump** versions to semver ranges (`eslint@8`, `chalk@4`), re-install, verify `.filedist.lock` updated and new files appear |
| 4 | **Remove** one package's managed files (`chalk`) while leaving others intact |
| 5 | **Add a new package** (`prettier@3`) to `.filedist.yml` and re-install |
| 6 | **Remove all** managed files |

## Config templates

| File | Purpose |
|---|---|
| `.filedistrc.v1.yml` | Old pinned versions — initial state |
| `.filedistrc.v2.yml` | Semver ranges — demonstrates lockfile update and new files appearing in newer releases |
| `.filedistrc.v3.yml` | New package added — demonstrates extending the config |

The active `.filedist.yml` is a working copy generated during tests and is not committed.

## Running

```bash
# From the repo root, build lib first:
make build -C lib

# Then run this example:
make test
```
