# Supabase offline bundle-executor contract

This contract defines the deterministic source-only planner for
`lifeline.supabase-bundle-executor.v1`. It validates the reviewed Platform
bundle denominator and returns a content-addressed `BLOCKED` plan and receipt.
It has no default live adapter and contains no provider client, database
driver, credential resolver, SQL executor, or runtime consumption ledger.

## Lifecycle

- source: `SOURCE_READY`;
- execution: `EXECUTION_BLOCKED`;
- apply admitted: `false`;
- offline planner source: implemented;
- live adapter: uninstalled;
- provider connectivity and SQL authority: absent.

The machine-readable blocked example is:

`examples/privileged-execution/supabase-bundle-execution.blocked.json`

The implementation and validator are:

`src/core/supabase-bundle-executor.ts`

## Exact Platform denominator

The request freezes Platform main
`2a871f8a9a7f3c030d7dca259de9ca88d336ec04`, tree
`718b816d262f05486c6692c67629e57a4846469e`, and manifest digest
`10b616019af3edad152f7a1cc922cbab20e5add81405f1f542053b54dacb2a54`.

The complete ordered denominator contains:

- 4 byte-identical inert/promoted artifacts;
- 721 executable statements and 532 held statements from 1,253 source
  statements;
- 122 migrations;
- the migration-package and governance identities;
- 5 contract bindings;
- 3 expected-effects and rollback bindings;
- 2 generator/verifier toolchain bindings.

Each binding carries its path, role, byte count, expected digest, and observed
digest. Reordering, omission, duplication, addition, or coherent digest
rebinding fails closed.

## Current action-time gates

The canonical request carries six blocked gates:

1. exact action-time authority and one-time consumption evidence;
2. 12 installed trust anchors;
3. sanitized Data API scope and configuration evidence;
4. credential-scope and transport evidence without values;
5. 7 inverse-capability proofs;
6. explicit apply admission.

Because every gate is blocked, the planner returns no ready plan and never
invokes an injected adapter. Adding or promoting a gate is not accepted by this
source contract; a new reviewed contract is required.

## Receipt and redaction

The receipt binds the canonical request digest, blocked-plan digest, executor
identity, lifecycle, and blocker count. Its own digest covers the complete
receipt subject.

Only aggregate identities and digests are serialized. SQL bytes, project
references, credential values, key material, raw provider responses, unknown
provider fields, and machine paths are forbidden.

## Failure boundary

Validation is total, deterministic, non-throwing, and non-echoing. Failures
name only the governed path and category. BigInt, cycles, throwing accessors,
proxies, inherited properties, unknown fields, secret-like markers, key IDs,
SPKI markers, and coherent rebinding all reject before any adapter call.

Rule: offline source implementation is not live-adapter installation.

Pattern: validate the complete reviewed denominator before any capability can
be considered for action-time installation.

Failure mode: treating a blocked content-addressed plan as authority to connect,
apply, deploy, retire, or delete.
