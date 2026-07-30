# Supabase live-adapter installation evidence runbook

This runbook verifies the source-only BLOCKED installation-evidence contract.
It is not an adapter installation or Supabase execution procedure.

## Verification

From the Lifeline repository root:

```powershell
pnpm run typecheck
pnpm run build
pnpm run test:supabase-execution-profile
pnpm run test:supabase-bundle-executor
pnpm run test:supabase-live-adapter-installation-evidence
pnpm run verify
```

Run the focused installation-evidence test twice and require byte-identical
stdout and empty stderr. Also run Biome on the eligible changed files and
`git diff --check`.

## Required source checks

Confirm all of the following:

- only the admitted six paths differ from the bound parent;
- the example fixture equals the canonical BLOCKED projection;
- every canonical primitive mutation rejects;
- proxies, prototype drift, inherited/symbol/non-enumerable/accessor
  properties, descriptor drift, cycles, BigInt values, and throwing traps
  reject without throwing or echoing candidate content;
- both valid and invalid requests report zero adapter invocations;
- exactly 12 trust-domain entries and seven inverse-capability entries remain
  in the closed denominator;
- every live provider fact remains `UNKNOWN`;
- `SOURCE_READY / EXECUTION_BLOCKED / apply_admitted=false` remains exact.

Scan the six-path source for secrets, credential values, concrete Supabase
project references, provider/network/database clients, raw SQL, raw provider
responses, and machine-specific paths. Any finding is a hold.

## Explicit non-actions

Do not install or register an adapter. Do not read provider or Supabase
configuration. Do not resolve secret references. Do not access Auth or live
data. Do not execute SQL, probe mutation permissions, apply migrations,
deploy, promote to production, or infer authority from passing verification.

Publication, provider access, apply, deployment, and production each require a
fresh, separately admitted lifecycle packet.
