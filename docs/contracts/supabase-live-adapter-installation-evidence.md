# Supabase live-adapter installation evidence contract

Status: `SOURCE_READY / EXECUTION_BLOCKED / apply_admitted=false`

## Purpose

This contract defines the complete evidence denominator that a future
Lifeline Supabase live adapter must satisfy before it can be considered
installed. It does not implement, register, invoke, or authorize an adapter.

The canonical request is deliberately BLOCKED. Current live provider facts are
recorded as `UNKNOWN`; absence of evidence is never promoted to absence of a
capability or to execution authority.

## Bound source identities

The contract binds:

- Lifeline main/tree `26be66ab22c6b7b469da69315b038dd478bfa71c` /
  `e15c05c864a0554918dbc8b1d6e8fb37a009ad28`;
- the canonical execution-control-plane profile and offline bundle-executor
  request digests;
- Fawxzzy Platform main/tree
  `2a871f8a9a7f3c030d7dca259de9ca88d336ec04` /
  `718b816d262f05486c6692c67629e57a4846469e`;
- the executable-bundle manifest, ordered artifacts, migration package,
  governance, contract, expected-effects/rollback, and toolchain identities.

## Closed evidence denominator

A future READY contract would require independently authenticated evidence for
all of the following:

1. versioned adapter build, registry identity, and installation receipt;
2. trusted action time, authority event, authority receipt, and one-time
   consumption receipt;
3. installation of all 12 ordered Ed25519 trust domains, without private key
   or raw key material;
4. the allowlisted sanitized Data API configuration reader, `rest:read` scope,
   `data_api_config_read` permission, and redactor identity;
5. secret-reference transport plus database and management capability
   receipts, without credential values;
6. all seven rollback, restore, revocation, disposal, absence-proof, and
   source-preservation mechanisms;
7. separately granted apply authority.

The canonical source supplies none of those action-time proofs. Its seven
blocker categories are `ADAPTER`, `AUTHORITY`, `TRUST`, `DATA_API`,
`CREDENTIAL`, `INVERSE`, and `APPLY`.

## Canonical representation and redaction

Validation is total, deterministic, non-throwing, and path/category-only.
Candidates must use exact ordinary-object and array prototypes, exact ordered
own keys, and canonical data-property descriptors. Native proxies, inherited
properties, symbols, non-enumerable properties, accessors, sparse arrays,
descriptor drift, cycles, BigInt values, and inaccessible representations fail
closed before any installation boundary can be called.

Failures never interpolate rejected values. The contract forbids credential
values, key material, project references, SQL bytes, raw provider responses,
provider error content, unknown provider fields, and machine paths.

## Lifecycle boundary

The exported installer interface is dependency-injected only to prove that the
BLOCKED path cannot call it. There is no READY representation, provider
client, database driver, network client, runtime registry mutation, SQL
execution, Supabase apply, deployment, or production behavior in this source.

