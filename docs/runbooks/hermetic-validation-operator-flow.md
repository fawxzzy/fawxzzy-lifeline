# Hermetic validation and receipt operator flow

This runbook is the shortest safe path through the Lifeline operator surface after the shared preflight and deterministic receipt changes.

## Sequence

1. Inspect the environment boundary before reading manifests.

```bash
pnpm lifeline doctor
```

Expected outcome:

- success means the local Node, package-manager, shell, and repo prerequisites match the repository contract
- failure prints a category plus the first remediation step; fix that first instead of chasing manifest errors

2. Validate through the canonical CLI boundary.

```bash
pnpm lifeline validate fixtures/runtime-smoke-app/runtime-smoke-app.lifeline.yml
pnpm lifeline validate fixtures/runtime-smoke-app/runtime-smoke-app.playbook.lifeline.yml --playbook-path fixtures/playbook-export
```

Notes:

- `validate` runs the same shared preflight that `doctor` reports explicitly
- mirror validation must go through `pnpm lifeline validate` or `node scripts/validate-fitness-mirror.mjs`
- do not validate helper behavior by importing temp-transpiled outputs from typeless temp roots; that can create fake Node/module-boundary failures on Windows

3. Run the intended runtime action only after preflight and validation are clean.

```bash
pnpm lifeline up fixtures/runtime-smoke-app/runtime-smoke-app.lifeline.yml
pnpm lifeline status runtime-smoke-app
```

Other valid runtime-facing actions in this phase are `restart` and `execute`, depending on the workflow you are proving.

4. Emit the auditable receipt surface that matches the work you just completed.

```bash
pnpm lifeline execute examples/privileged-execution/read-only-scan.request.json \
  --capability-profile examples/privileged-execution/capability-profile.json \
  --approval-receipt examples/privileged-execution/read-only-scan.approval.json

pnpm lifeline proof-pass ../../runtime/atlas/ui-proof/fitness/latest.json \
  --source-repo fitness \
  --tranche F11
```

Receipt expectations:

- `execute` writes a receipt for every attempt, including blocked attempts
- `proof-pass` writes a deterministic `proof_passed` receipt only when the referenced ATLAS proof summary is clean and `completion_ready=true`
- receipt ids and receipt paths are derived from governed inputs, and path-like refs are normalized before write so Windows and POSIX output stays diffable
- when receipt emission fails, Lifeline prints a failure category and the first remediation step instead of a vague generic error

## Troubleshooting

- Rule: validation must execute through the same boundary as real operator usage.
- Pattern: shared preflight first, canonical validate second, runtime action third, deterministic receipt last.
- Failure Mode: temp transpile paths create fake module-boundary failures that do not represent the real runtime.
- Failure Mode: late environment discovery makes validation noisy and hides the actual root cause.
