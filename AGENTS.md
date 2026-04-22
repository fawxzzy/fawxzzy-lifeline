# Fawxzzy-Lifeline Repo Rules

Scope
- Applies to `repos/fawxzzy-lifeline`.
- This repo is the governed local operator and execution surface.

Purpose
- Keep Lifeline narrow, deterministic, and local-first.
- Preserve the read-only and approval-gated execution posture unless a task explicitly widens a governed capability.

Rules
- Prefer changes that strengthen receipts, capability enforcement, runtime clarity, and predictable CLI behavior.
- Do not turn Lifeline into a hosted platform, dashboard, or ambient admin surface.
- When ATLAS root depends on Lifeline behavior, keep the contract explicit in examples, receipts, and tests.

Verification
- Run `pnpm run verify` before claiming repo-local completion.
- `verify` is the repo-local contract and currently composes:
  - `pnpm run typecheck`
  - `pnpm run build`
  - `pnpm run test:privileged-execution-bridge`
  - `pnpm run test:privileged-execution-repair`
  - `pnpm run test:ui-proof-receipt`
