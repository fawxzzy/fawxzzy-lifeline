# Startup rollup verification (2026-04-06)

## Repo health check
- Public repo: `ZachariahRedfield/fawxzzy-lifeline`.
- Pull requests: 9 open, 213 closed.
- Startup rollup PR #236 is merged into `main` on 2026-04-06.

## Startup rollup PR verdict
- Verified PR URL: https://github.com/ZachariahRedfield/fawxzzy-lifeline/pull/236
- PR #236 (`codex/push-startup-rollup-pr-to-main` -> `main`) is **docs-only**.
- GitHub-visible diff contains only:
  - `README.md`
  - `docs/startup-contract.md`
- Therefore PR #236 does **not** include these paths in its own diff:
  - `src/core/startup-backend.ts`
  - `src/core/startup-backends/**`
  - `docs/architecture.md`
  - startup deterministic scripts

## Coverage + fallback truth after PR
- `main` currently contains startup backend registry + implementations for:
  - `aix`, `darwin`, `freebsd`, `linux`, `netbsd`, `openbsd`, `win32`
- Unsupported platforms still resolve to explicit contract-only fallback via `createUnsupportedBackend()` in `src/core/startup-backend.ts`.
- Startup deterministic scripts are present in `scripts/` (including seam/backend + platform-specific startup tests).

## Exact highest-leverage next initiative
**Land PR #222 (or equivalent) that hardens startup backend behavior in runtime code**:
- clarify unsupported fallback details (`src/core/startup-backend.ts`)
- improve Windows Task Scheduler restore entrypoint matching (`src/core/startup-backends/windows-task-scheduler.ts`)
- surface persisted-vs-live startup status coherence (`src/core/startup-contract.ts`, `src/commands/startup.ts`)
- keep deterministic seam/backend coverage (`scripts/test-startup-windows-seam-backend-flow-deterministic.mjs`, `scripts/test-suites.json`)

This is the top product-leverage gap because it improves real startup behavior/observability, not just docs.

## Parallelization plan with file ownership boundaries
### Recommendation
- **One PR** for the highest-leverage startup hardening slice because files overlap in one runtime flow (`startup` command -> backend seam -> windows backend -> startup state detail).

### Ownership boundaries
- Bundle A (single PR):
  - `src/core/startup-backend.ts`
  - `src/core/startup-backends/windows-task-scheduler.ts`
  - `src/core/startup-contract.ts`
  - `src/commands/startup.ts`
  - `scripts/test-startup-windows-seam-backend-flow-deterministic.mjs`
  - `scripts/test-suites.json`

- Optional parallel low-risk docs follow-up (separate PR, lower priority):
  - docs-only startup wording alignment in `README.md`, `docs/startup-contract.md`, `docs/architecture.md`

## Copy-paste-ready next Codex prompt(s)
### Prompt 1 — single highest-leverage PR (recommended)
```
Work only in fawxzzy-lifeline.

Objective
Ship the highest-leverage startup runtime hardening after merged PR #236 docs-only rollup.

Scope
- Implement in one cohesive PR:
  - src/core/startup-backend.ts (unsupported fallback detail clarity only)
  - src/core/startup-backends/windows-task-scheduler.ts (case-insensitive canonical restore entrypoint matching)
  - src/core/startup-contract.ts (persisted startup intent/state vs live backend inspection coherence detail)
  - src/commands/startup.ts (explicit contract-only fallback line when backend mutation returns unsupported)
  - scripts/test-startup-windows-seam-backend-flow-deterministic.mjs
  - scripts/test-suites.json registration

Hard rules
- Lifeline-only.
- Preserve unsupported fallback semantics (no behavior regression).
- Preserve dry-run non-mutation semantics.
- Do not reopen Playbook↔Fitness seam/bootstrap/esbuild issue.
- Prefer product behavior gap closure over docs-only edits.

Validation
- Run targeted deterministic startup tests and include exact commands/results.
- Summarize behavior deltas in user-facing startup status output.

Return
- concise diff summary
- test results
- rollback risk notes
```

### Prompt 2 — optional lower-priority docs-only follow-up
```
Work only in fawxzzy-lifeline.

Objective
After startup runtime hardening merges, align startup docs to shipped behavior.

Scope
- README.md
- docs/startup-contract.md
- docs/architecture.md

Hard rules
- Docs must reflect actual shipped runtime behavior on main.
- No runtime code changes in this PR.
- Do not reopen Playbook↔Fitness seam/bootstrap/esbuild issue.

Validation
- Run parity checks that verify docs and startup contract consistency.

Return
- exact wording deltas
- validation commands + results
```
