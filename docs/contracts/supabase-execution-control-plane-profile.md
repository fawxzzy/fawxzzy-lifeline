# Supabase execution-control-plane profile

This document defines Lifeline's source-only profile for a future governed
Supabase executable-bundle worker. It closes the profile-definition gap; it
does not implement the worker, install trust anchors, read credentials, connect
to Supabase, or authorize SQL execution.

## Ownership and lifecycle

- Lifeline owns the capability, request, approval, execution, and receipt
  semantics for the future worker.
- Fawxzzy Platform owns the reviewed executable bundle and the target,
  rehearsal, recovery, security, and evidence contracts it binds.
- ATLAS may later register an exact Lifeline tool profile, but the registry is
  outside this source packet.
- The source state is `SOURCE_READY`.
- Execution is `EXECUTION_BLOCKED`.
- `apply_admitted` is `false`.

The canonical machine-readable contract is:

`examples/privileged-execution/supabase-execution-profile.blocked.json`

The canonical validator is:

`src/core/supabase-execution-profile.ts`

## Bound executable bundle

The profile is bound to the merged Platform source at commit
`2a871f8a9a7f3c030d7dca259de9ca88d336ec04`, tree
`718b816d262f05486c6692c67629e57a4846469e`, and executable-bundle manifest
version `1.0.0`.

It also freezes the reviewed manifest digest, ordered four-artifact identity,
122-migration package, governance manifest, contract binding set,
effects/rollback binding set, and toolchain set. A coherent caller-side
rebinding is not accepted.

## Executor boundary

The named future executor is `lifeline.supabase-bundle-executor.v1`.

Its current implementation state is
`PROFILE_DEFINED_EXECUTOR_UNIMPLEMENTED`. Provider connectivity, credential
values, and SQL authority are absent. A later implementation must bind to the
exact profile identity and pass a separate source review before it can be
considered for installation or action-time use.

## Trust-anchor denominator

The profile freezes 12 ordered Ed25519 evidence domains:

1. disposable-target bootstrap apply authority;
2. disposable-target bootstrap authority consumption;
3. Auth/application-data execution authority;
4. Auth/application-data executor capability;
5. Auth/application-data write-barrier authority;
6. Auth/application-data write-barrier consumption;
7. Storage/Edge/Realtime forward evidence;
8. Storage/Edge/Realtime per-surface rollback;
9. Storage/Edge/Realtime disposal absence;
10. Storage/Edge/Realtime credential revocation;
11. GitHub release attestation;
12. GitHub release independent readback.

Every entry is `UNPROVISIONED_BLOCKED`. Key IDs, SPKI digests, installation
references, and all private signing material are absent. The validator rejects
omission, duplication, reordering, cross-role substitution, caller-supplied
key material, or an installed/current claim.

## Sanitized Data API reader

The only named read is:

- method: `GET`;
- path: `/v1/projects/{ref}/postgrest`;
- OAuth scope: `rest:read`;
- fine-grained permission: `data_api_config_read`.

Action time must select and authenticate exactly one permitted mechanism. The
persisted allowlist contains only governed PostgREST configuration fields plus
status, observation time, and a sanitized digest.

`jwt_secret`, unknown provider fields, and raw provider responses must be
discarded before hashing or receipt serialization. `PATCH`, `rest:write`, and
`data_api_config_write` remain outside this profile and separately gated.

## Credential and transport references

The profile names references, never values:

- `secret://lifeline/supabase/executor/database-url`;
- `secret://lifeline/supabase/executor/management-api-oauth-token`.

The database transport remains action-time unresolved between direct Postgres
on port 5432 and the session pooler on port 5432; either requires SSL. The
profile names future bundle verification, transactional ordered apply, catalog
read A/B, negative probes, and inverse rollback, but none is executable here.

Seed, reset, migration repair, broad drop, production use, source mutation,
source retirement, and credential-value serialization are forbidden.

## Inverse capability boundary

The following mechanisms are named but remain blocked until separately
authenticated receipts exist:

- independent GitHub-vault backup and restore;
- rollback preimage, plan, authority, and postimage-equals-preimage proof;
- reverse-order Storage/Edge/Realtime inverse receipts;
- credential revocation;
- target disposal completion;
- a distinct post-disposal absence proof.

Source systems must remain active throughout this program. Profile definition
does not authorize cleanup, retirement, or deletion.

## Validation rule

This contract uses a closed canonical blocked projection. Any missing, extra,
reordered, rebound, promoted, or caller-authored field fails validation.

Rule: a complete profile can name a future control plane without claiming that
the control plane exists.

Pattern: Platform defines the reviewed byte/evidence set; Lifeline defines the
execution lineage; a later ATLAS registry packet binds the two.

Failure mode: treating a source profile, connector visibility, or a secret
reference as installed capability or apply authority.
