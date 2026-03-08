<!--
SYNC IMPACT REPORT
==================
Version change: (none) -> 1.0.0 -- initial ratification from template.
Modified principles: N/A (first fill).
Added sections: I. Library-First Architecture, II. CLI Interface,
  III. Test-First, IV. Decision-Driven Development, V. Quality Gates,
  Development Standards, Agent Workflow, Governance.
Removed sections: N/A
Templates requiring updates:
  OK .specify/templates/plan-template.md  -- no structural changes needed.
  OK .specify/templates/spec-template.md  -- no changes needed.
  OK .specify/templates/tasks-template.md -- no changes needed.
Follow-up TODOs:
  - TODO(XDR_PATH): No .xdrs/ directory found. Create .xdrs/index.md and seed
    with initial XDRs to enable Principle IV. Until then, treat spec.md and
    README.md as interim decision records.
-->

# npmdata Constitution

## Core Principles

### I. Library-First Architecture

The core extraction, check, purge, and init logic MUST live in the `lib/` TypeScript library,
organised into three layers: `cli/` (thin UI adapter), `package/` (orchestration and action
execution), and `fileset/` (diff calculation and file-set processing). The CLI layer MUST contain
only argument parsing, console output, and user-facing error handling -- no business logic. All
features MUST be implementable and testable as library functions before any CLI surface is added.

**Rationale**: Keeps the library independently consumable, testable, and documentable. The CLI is
a delivery mechanism, not the source of truth for behaviour.

### II. CLI Interface

Every core capability (extract, check, purge, init, list) MUST expose a CLI entry point. The text
I/O protocol is: stdin/args -> stdout, errors -> stderr. Human-readable output is the default; JSON
output MUST be supported where programmatic consumption is expected. Exit codes MUST be non-zero on
failure.

**Rationale**: The CLI is the primary integration surface for consumers running `npx npmdata`.
Consistent I/O conventions enable scripting, CI/CD pipelines, and composability with other tools.

### III. Test-First (NON-NEGOTIABLE)

Unit tests MUST be co-located with source files (`*.test.ts`) and written before or alongside
implementation. Integration tests MUST cover end-to-end flows for each CLI command. The
Red-Green-Refactor cycle is the expected development rhythm. A change is not complete until
`make test` passes with no failures and no regressions.

**Rationale**: The extraction algorithm is stateful and recursive; correctness regressions are hard
to detect manually. Automated tests are the primary safety net.

### IV. Decision-Driven Development

All significant implementation decisions MUST be preceded by consulting XDRs (cross-domain records)
in `.xdrs/`. XDRs are the authoritative source of truth for architecture, patterns, naming
conventions, and behavioural contracts. Implementation agents MUST:

- Read `.xdrs/index.md` before starting any design or implementation step.
- Follow XDR guidance without deviation unless a new or amended XDR is created first.
- Re-validate their completed work against relevant XDRs before marking a task done.

When no applicable XDR exists, a new one MUST be proposed before the implementation proceeds.

**Rationale**: Prevents ad-hoc architectural drift across contributors and AI agents. XDRs are the
project memory that survives context resets.

### V. Quality Gates

Every change MUST pass all three gates before being considered complete:

1. `make build` -- TypeScript compilation with no errors.
2. `make lint-fix` -- ESLint auto-fix followed by zero remaining lint violations.
3. `make test` -- Full test suite with no failures and no regressions.

Gates MUST be run in the order listed; failures MUST be fixed, not suppressed or skipped.

**Rationale**: Quality gates encode the project's definition of "done" and are the minimum bar for
any contribution landing in the main branch.

## Development Standards

- **Language**: TypeScript (strict mode); CommonJS output targeting the Node.js LTS release.
- **Package manager**: pnpm; `pnpm-lock.yaml` MUST be committed alongside any dependency changes.
- **Config discovery**: cosmiconfig is the authoritative config resolution mechanism; no custom
  loaders are permitted outside of what cosmiconfig natively supports.
- **Marker files**: `.npmdata` marker files track managed file ownership; their format and semantics
  are defined in `fileset/markers.ts` and MUST NOT change without an XDR amendment.
- **Symlinks**: Symlink handling is a first-class feature; behavioural changes to symlink resolution
  require explicit test coverage and an XDR amendment if the public contract changes.

## Agent Workflow

Rules that apply to automated coding agents (AI or scripted) working in this repository:

- Agents MUST NOT perform git operations (add, commit, push, branch creation, tagging, etc.).
- Agents MUST consult XDRs before any implementation and re-validate after completion (Principle IV).
- Agents MUST run all three quality gates and fix any failures before declaring a task done (Principle V).
- Agents MUST NOT leave the codebase in a partially implemented or failing state at the end of a session.

## Governance

This constitution supersedes all other informal project practices. When a conflict arises between
this document and any other guidance source, this constitution takes precedence unless a superseding
amendment has been ratified.

**Amendment procedure**:

1. Open an issue or PR describing the proposed change and its rationale.
2. Update this file following semantic versioning:
   - MAJOR -- backward-incompatible governance change, principle removal, or redefinition.
   - MINOR -- new principle or section added, or materially expanded guidance.
   - PATCH -- clarifications, wording refinements, typo fixes.
3. Update `Last Amended` to the ISO date of the amendment.
4. Run the `speckit.constitution` command to propagate changes to dependent templates.

**Compliance review**: All pull requests MUST include a Constitution Check section in the
implementation plan confirming the five core principles and quality gates are satisfied.

**Version**: 1.0.0 | **Ratified**: 2026-03-08 | **Last Amended**: 2026-03-08
