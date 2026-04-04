# Startup contract (merged Wave 2)

Merged Wave 2 defines Lifeline's startup-registration seam and deterministic CLI/state behavior. This document tracks the contract boundary and current runtime behavior, including the current Windows fallback path.

## Scope

- Startup registration scope is **machine-local**.
- The contract target is always the Lifeline restore entrypoint: `lifeline restore`.
- The contract is platform-neutral and does not expose Task Scheduler/systemd/launchd specifics.

## CLI surface

```bash
lifeline startup status
lifeline startup enable [--dry-run]
lifeline startup disable [--dry-run]
```

Semantics:

- `enable`: call the startup backend seam `install` operation, then persist startup intent as `enabled`.
- `disable`: call the startup backend seam `uninstall` operation, then persist startup intent as `disabled`.
- `status`: report current contract state and backend readiness from the active backend seam inspection.
- `--dry-run`: print the plan without writing state or invoking backend install/uninstall mutations.

The contract's canonical startup target is always `lifeline restore`; startup backends must reuse this entrypoint and must not introduce duplicate lifecycle logic.

Status output shape (deterministic):

```text
Startup supported: <yes|no>
Startup enabled: <yes|no>
- mechanism: <backend mechanism>
- scope: machine-local
- restore entrypoint: lifeline restore
- detail: <backend/status detail>
```

## Contract-only vs real backend status

Current default runtime status is **contract-only**. That means:

- the CLI and persisted startup metadata are real and deterministic now
- backend seam calls are real (`install`, `uninstall`, `inspect`)
- the default selected backend may still be `unsupported` for a platform

Contract behavior split:

- `startup enable`/`startup disable` always call backend seam install/uninstall before persisting intent.
- `startup status` always reports the active seam `inspect` view plus persisted intent.
- `enable --dry-run` / `disable --dry-run` execute planning only and remain non-mutating.

When the selected backend is unsupported, backend readiness resolves as `unsupported` and `.lifeline/startup.json` persists that seam result after non-dry-run `enable` and `disable`.

Once a platform backend lands, this document and deterministic startup verification must be updated in the same change set to keep behavior discoverable.

## Windows status (current)

As of April 4, 2026, default `win32` backend resolution remains contract-only unsupported in normal CLI flow. Lifeline therefore does **not** currently guarantee Task Scheduler registration from `lifeline startup enable`.

Expected unsupported detail shape:

- `No startup installer backend is available on win32 yet.`
- `Intent can still be recorded for future backend availability.`

## Restore entrypoint wiring

The canonical startup target remains `lifeline restore`. Startup backends must route to this entrypoint and must not introduce duplicate restore/bootstrap lifecycle entrypoints.

## Persisted metadata

Lifeline persists only minimal Wave 2 metadata in `.lifeline/startup.json`:

- contract `version`
- startup `scope` (`machine-local`)
- `restoreEntrypoint` (`lifeline restore`)
- desired `intent` (`enabled` or `disabled`)
- `backendStatus` readiness marker (`not-installed`)
- `updatedAt` timestamp

No platform-specific registration identifiers are persisted in this slice.

## Backend contract expectation

Future platform installers must plug into this contract, not bypass it. Backends should read the contract intent and apply OS-specific wiring while preserving the contract's machine-local scope and restore-entrypoint target.
