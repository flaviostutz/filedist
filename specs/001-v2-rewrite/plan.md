# Implementation Plan: npmdata v2 — Clean-room Reimplementation

**Branch**: `001-v2-rewrite` | **Date**: 2026-03-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-v2-rewrite/spec.md`

## Summary

Implement npmdata v2 as a complete clean-room rewrite in a new `lib/src/v2/` subfolder within the existing `lib/` project.
The rewrite must not modify any existing file in `lib/src/` (v1 code) or anywhere outside `lib/`. It follows the three-layer architecture
(`cli/`, `package/`, `fileset/`) from `lib/spec.md`, uses direct in-process function calls
instead of per-entry subprocess spawning, and implements a two-phase diff/execute model.
Five CLI commands (`extract`, `check`, `list`, `purge`, `init`) plus a `run()` self-install
function are exposed. The new implementation reuses the existing `lib/` toolchain (tsconfig.json,
jest.config.js, babel.config.js, Makefile, package.json, pnpm-lock.yaml) — no separate project
scaffold is needed. Stack and testing strategy are identical to v1: TypeScript strict,
pnpm, Jest + esbuild-jest, co-located `*.test.ts`, `installMockPackage` helper for integration tests.

## Technical Context

**Language/Version**: TypeScript 5.x — strict mode; CommonJS output targeting Node.js LTS (20.x)
**Primary Dependencies**: `cosmiconfig` (config discovery), `minimatch` (glob matching), `ignore`
(gitignore-style pattern filtering), `semver` (version range resolution) — identical set to v1
**Storage**: File system only (`.npmdata` CSV marker files, `.gitignore` updates, extracted files)
**Testing**: Jest 29 with `esbuild-jest` transformer; co-located `*.test.ts`; `installMockPackage`
helper (pnpm + `archiver`) for realistic package install/extract integration tests
**Target Platform**: Node.js LTS (20.x) on macOS and Linux
**Project Type**: CLI tool + library (npm-published; also usable as a programmatic API)
**Performance Goals**: SC-001 — extract up to 100 files from a single package in under 30 s
**Constraints**: No subprocess spawning per entry (FR-004); no modifications to existing files in `lib/src/` (v1 code) or outside `lib/`
(FR-001); no file exceeds 400 lines (SC-007)
**Scale/Scope**: Packages up to 100 files; dependency chains up to 3 levels deep

## Constitution Check

*GATE: Evaluated pre-design (Phase 0) and re-checked post-design (Phase 1).*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Library-First Architecture | PASS | Three-layer cli/ / package/ / fileset/; no business logic in CLI layer |
| II. CLI Interface | PASS | All 5 commands; non-zero exit on failure; stdout/stderr split |
| III. Test-First | PASS | *.test.ts co-located; diff phase tested independently of execute phase (SC-006) |
| IV. Decision-Driven Development | PASS | .xdrs/index.md consulted; no amendment needed |
| V. Quality Gates | PASS | make build -> make lint-fix -> make test required before done |

No gate violations. No complexity-tracking entries required.

## Project Structure

### Documentation (this feature)

```
specs/001-v2-rewrite/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── cli-contract.md  # CLI command/flag surface contract
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code

```
lib/src/v2/
├── index.ts           # public library exports (extract, check, list, purge, run)
├── main.ts            # CLI entry point -> cli/cli.ts
├── types.ts           # all shared types (PackageConfig, SelectorConfig, OutputConfig,
│                    #   ExecutionConfig, NpmdataExtractEntry, NpmdataConfig, ...)
├── utils.ts           # shared utilities (file hash, CSV marker r/w, pkg manager
│                    #   detection, parsePackageSpec, installPackage, ...)
├── utils.test.ts
├── cli/
│   ├── cli.ts          # top-level CLI router: cosmiconfig load + command dispatch
│   ├── cli.test.ts
│   ├── config.ts       # cosmiconfig wrapper (loadNpmdataConfig)
│   ├── usage.ts        # --help text generation per command
│   └── commands/
│       ├── extract.ts   # argv parse + call action-extract
│       ├── check.ts     # argv parse + call action-check
│       ├── list.ts      # argv parse + call action-list
│       ├── purge.ts     # argv parse + call action-purge
│       └── init.ts      # scaffold package.json + bin entry-point
├── package/
│   ├── index.ts              # re-exports public package-layer API
│   ├── action-extract.ts     # orchestrate diff+execute across filesets; rollback on error
│   ├── action-extract.test.ts
│   ├── action-check.ts       # orchestrate check across filtered filesets
│   ├── action-check.test.ts
│   ├── action-list.ts        # read markers across unique output dirs
│   ├── action-list.test.ts
│   ├── action-purge.ts       # purge managed files + symlinks + empty dirs
│   ├── action-purge.test.ts
│   ├── action-init.ts        # scaffold publishable package
│   ├── runner.ts             # run(binDir, argv) — self-installable package entry point
│   ├── runner.test.ts
│   ├── argv.ts               # argv parsing helpers (flags, presets, output, etc.)
│   ├── argv.test.ts
│   ├── config-merge.ts       # merge SelectorConfig + OutputConfig across recursion levels
│   ├── config-merge.test.ts
│   ├── symlinks.ts           # post-extract symlink creation + stale-link removal
│   ├── symlinks.test.ts
│   ├── content-replacements.ts  # apply + verify contentReplacements entries
│   └── content-replacements.test.ts
└── fileset/
    ├── index.ts         # re-exports public fileset-layer API
    ├── diff.ts          # Phase 1: pure read-only diff -> ExtractionMap (no disk writes)
    ├── diff.test.ts     # unit tests for diff phase independent of execute (SC-006)
    ├── execute.ts       # Phase 2: apply ExtractionMap -> disk, marker, gitignore
    ├── execute.test.ts
    ├── check.ts         # call diff(); classify modified/missing/extra drift
    ├── check.test.ts
    ├── list.ts          # read .npmdata markers -> return managed file list
    ├── purge.ts         # delete managed files + symlinks + empty dirs from marker
    ├── purge.test.ts
    ├── gitignore.ts     # .gitignore create / update alongside .npmdata markers
    ├── gitignore.test.ts
    ├── markers.ts       # .npmdata CSV marker read / write (format preserved from v1)
    ├── package-files.ts # pkg manager install (auto-detect) + file enumeration
    ├── package-files.test.ts
    ├── constants.ts     # MARKER_FILE, DEFAULT_FILENAME_PATTERNS
    └── test-utils.ts    # installMockPackage (tar.gz + pnpm install; same as v1)
```

**Structure Decision**: New code in `lib/src/v2/` subfolder, reusing the existing `lib/` toolchain
(tsconfig, jest, eslint, Makefile) — no standalone project needed. Key architectural change from v1:
`package/action-*.ts` call `fileset/diff.ts` and `fileset/execute.ts` directly as in-process
function calls — no subprocess spawning — enabling the two-phase model and independent unit testing
of each phase. When `fileset/diff.ts` encounters a dependency package entry it calls back into
`package/action-extract.ts` (bidirectional call pattern from `lib/spec.md`).
`fileset/check.ts` reuses `diff.ts` output to classify drift (FR-011) rather than re-reading
package files independently.
