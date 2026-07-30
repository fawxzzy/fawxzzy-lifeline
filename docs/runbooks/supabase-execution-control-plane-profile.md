# Supabase execution-profile operator flow

This runbook is for source validation only. It must not be used to connect to a
Supabase project or apply the executable bundle.

## Validate the blocked profile

From the Lifeline repository root:

```bash
pnpm run typecheck
pnpm run build
pnpm run test:supabase-execution-profile
pnpm run verify
```

Expected state:

- the deterministic profile test passes;
- the full Lifeline verification chain passes;
- the profile reports `SOURCE_READY`;
- execution reports `EXECUTION_BLOCKED`;
- `apply_admitted` remains `false`;
- the offline bundle-executor source is implemented;
- the live adapter remains uninstalled;
- all 12 trust anchors remain `UNPROVISIONED_BLOCKED`;
- no provider connection, credential value, SQL execution, deployment, or
  production action occurs.

## What this source packet proves

It proves that the future Lifeline worker has one complete, deterministic
profile denominator:

- exact Platform executable-bundle identities;
- the 12 ordered evidence domains;
- a read-only, redacted PostgREST configuration-reader contract;
- secret references without secret values;
- the permitted future operation set and forbidden operation set;
- the complete inverse-capability mechanism list.

It does not prove that the live adapter, keys, OAuth scopes, database
credentials, backup service, inverse executor, or disposal mechanism is
installed.

## Next serialized work

Only after this profile is independently reviewed and merged:

1. independently review and merge the offline planner source;
2. add one exact ATLAS tool-registry entry and live-adapter installation bound
   to the merged profile digest;
3. provision public trust anchors and prove their installed identities in a
   separate non-secret packet;
4. prove the sanitized Data API reader, credential scopes, backup, rollback,
   restore, revocation, disposal, and absence mechanisms read-only;
5. request fresh action-time authority for a named target and exact actions.

No step inherits provider or apply authority from the previous step.

## Fail-closed conditions

Stop if:

- a Platform bundle identity drifts;
- any trust domain is missing, duplicated, reordered, or caller-authored;
- the profile contains key material or credential values;
- the Data API reader can persist `jwt_secret` or a raw provider response;
- a write scope or provider mutation appears;
- an inverse capability is missing or promoted without authenticated evidence;
- any lifecycle field claims execution readiness or apply authority.

The remediation is a new source review or a separately authorized capability
packet. Do not test mutation permission by attempting a write.
