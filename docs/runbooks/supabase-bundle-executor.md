# Supabase offline bundle-executor validation

This runbook verifies the source-only planner. It must not be used to connect
to Supabase or execute the promoted artifact set.

## Verification

From the Lifeline repository root:

```bash
pnpm run typecheck
pnpm run build
pnpm run test:supabase-bundle-executor
pnpm run test:supabase-execution-profile
pnpm run verify
pnpm run check
git diff --check
```

Run both focused tests twice and require byte-identical standard output, empty
standard error, and exit zero.

Expected source state:

- the blocked fixture equals the source-frozen canonical request and result;
- the complete manifest/artifact/package/binding/toolchain denominator passes;
- the canonical plan and receipt are stable and content-addressed;
- every action-time gate remains blocked;
- adapter invocation count remains zero;
- hostile and coherently rebound inputs reject without throw or echo;
- `SOURCE_READY / EXECUTION_BLOCKED / apply_admitted=false` remains exact.

## What this proves

This proves that Lifeline can deterministically validate the reviewed aggregate
bundle denominator and explain why execution is blocked. It also proves that
the offline source and the execution profile agree about the uninstalled live
adapter.

It does not prove:

- provider connectivity;
- trust-anchor installation;
- a sanitized live Data API reader;
- credential availability or scope;
- backup, rollback, restore, revocation, disposal, or absence capability;
- action-time authority or one-time consumption;
- SQL apply, deployment, production, cleanup, or source retirement.

## Fail-closed operator flow

1. Validate the exact blocked fixture.
2. Confirm the six ordered blocker categories.
3. Confirm the adapter invocation count is zero.
4. Preserve the source-only receipt and exact source identity.
5. Request a separately reviewed live-adapter installation packet only after
   all required public identities and non-secret capability mechanisms are
   named.

Do not probe mutation permission by attempting a write. Do not resolve a
credential reference or persist an action-time project reference during source
verification.

## Future serialized boundary

A later installation packet must bind the merged Lifeline source digest,
Platform manifest digest, exact trust-anchor identities, sanitized Data API
reader, credential-scope evidence, inverse mechanisms, and fresh action-time
authority. It must still obtain separate apply authority.
