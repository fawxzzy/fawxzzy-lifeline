# Playbook Notes

Use this file to record meaningful code changes in a concise, reviewable format.
Link related pull requests whenever possible.

## 2026-04-22

- WHAT changed:
  - Replaced the PR and `main` hosted gate with one canonical GitHub Actions `verify` job that runs `pnpm run verify`.
  - Removed workflow-side reconstruction of test lists so the hosted gate now covers the repair-receipt path through the same repo contract used locally.
  - Demoted the Playbook smoke workflow to a manual supplemental lane so it no longer drifts into the authoritative PR or `main` gate.
  - Documented the exact required merge check as `verify` and pinned the hosted job name explicitly so branch protection can target a stable check run.
- WHY it changed:
  - Hosted CI had broad coverage, but it still missed part of the declared `verify` contract and could drift as local verification changed.
  - Branch protection should reflect the same narrow contract operators run before claiming repo-local completion.
- Rule:
  - Hosted CI must execute the same canonical verification contract as local repo verification, and merge policy must require that exact hosted `verify` check.
- Pattern:
  - Prefer one authoritative `verify` entrypoint and one explicit hosted `verify` check over duplicated workflow-specific test lists or ambiguous required-check names.
- Failure mode addressed:
  - Manually reconstructed workflow gates or mismatched required checks can miss verify-only coverage such as privileged execution receipt repair, or let policy drift away from the canonical contract.
  - Future canary PRs must stay blocked on `verify` until it passes and must not treat `Playbook Smoke` as a required merge blocker.

## 2026-04-21

- WHAT changed:
  - Reframed README, architecture, scope, and operator docs around the shared preflight contract and the hermetic `doctor -> validate -> runtime -> receipt/proof-pass` path.
  - Added a concise operator runbook for validation, runtime action, deterministic execution receipts, and proof-backed completion receipts.
  - Tightened the README command-surface test so the documented CLI surface must continue to include `execute` and `proof-pass`.
- WHY it changed:
  - Wave 1 changed the real operator seam, but the docs still mixed startup-wave language with the newer preflight and receipt model.
  - Operators need one canonical path that explains where environment failures stop, where manifest validation begins, and how deterministic receipts surface the first remediation step.
- Rule:
  - Validation must execute through the same CLI boundary operators use for real runtime-facing work.
- Pattern:
  - Shared preflight first, canonical validate second, runtime action third, deterministic receipt last.
- Failure mode addressed:
  - Temp transpile paths and late environment discovery can create noisy module-boundary failures that do not match the real Lifeline boundary.

## 2026-04-22

- WHAT changed:
  - Expanded deterministic preflight rejection fixtures across `node-version`, `package-manager`, `shell-runtime`, and `repo-prerequisite` classifications.
  - Expanded `proof-pass` deterministic fixtures for unreadable proof refs, malformed summaries, owner mismatches, blocked proof states, and Windows-oriented path canonicalization.
  - Canonicalized ATLAS-internal absolute proof refs to stack-relative forward-slash refs before proof-passed receipt write.
- WHY it changed:
  - Failure categories and first-remediation guidance need direct fixture coverage so proof/operator surfaces stay stable instead of drifting with ad hoc stderr text.
  - Windows and mixed-path runs should emit the same proof receipt refs as POSIX runs at the artifact boundary.
- Pattern:
  - Fixture-back failure categories and normalize path refs at receipt emission, not only at display time.
- Failure mode addressed:
  - Proof receipts could preserve machine-local absolute Windows report paths even when the reports were inside the ATLAS root, making artifacts less canonical and less diffable.

## 2026-03-25

- WHAT changed:
  - Updated runtime smoke polling to read canonical restart telemetry from `.lifeline/state.json`.
  - Added deterministic crash checks for the HTTP crash path, expecting persisted `restartCount` to increment through supervised recovery.
  - Kept status assertions focused on coherence (`supervisor` and `child` alive + healthy endpoint), while restart-count waiting now uses state persistence directly.
  - Updated changelog with the smoke-accounting fix and rationale.
- WHY it changed:
  - RestartCount mutations happen in supervisor state persistence; parsing human-readable status output could miss or mis-time those updates and cause false smoke timeouts.
  - Governance rule requires runtime changes to be documented with WHAT/WHY.
- Evidence (PR / issue / commit):
  - Follow-up commit on this branch addressing smoke timeout waiting for `restartCount >= 1`.

## 2026-04-03

- WHAT changed:
  - Refactored status proof-mode control flow so proof payload serialization is invariant and always emitted before any proof-gate exit enforcement is applied.
  - Added proof output modes for `status` (`--proof` JSON and `--proof-text` operator brief) and explicit gate enforcement (`--proof-gate` / `--enforce-proof-gate`).
  - Extended deterministic status verification to assert additive-safe proof payload emission on both success and enforced-failure paths.
- Pattern:
  - Serialize proof state first, apply enforcement exit policy second.
- Rule:
  - Proof-mode rendering is invariant; enforcement changes exit code only and never mutates or suppresses payload/brief shape.
- Failure mode addressed:
  - Short-circuiting unhealthy proof states into generic CLI failure output can drop the proof contract and incorrectly force non-zero exits for operator-facing proof status.
- WHY it changed:
  - Keeps operator status reporting readable and stable while preserving fail-closed behavior for explicit proof-gate use cases.

## 2026-04-13

- WHAT changed:
  - Added a new `lifeline execute` command that loads a capability profile, privileged-action request, and approval receipt from local JSON files.
  - Implemented read-only filesystem inspection and dry-run command execution paths with local receipt writing under `.lifeline/receipts/`.
  - Added example capability/request/approval inputs and a new privileged-execution doc surface.
- WHY it changed:
  - Lifeline needed a first real execution surface for capability- and approval-backed work without introducing ambient admin rights.
  - Receipt-backed execution keeps the runtime path explicit, local, and auditable.
