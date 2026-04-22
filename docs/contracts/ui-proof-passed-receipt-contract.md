# Lifeline UI proof-passed receipt contract

This document is the canonical owner-repo contract path for Lifeline proof-backed completion receipts.

ATLAS owns proof derivation. `_stack` and Playbook may enforce completion on those proof results. Lifeline owns the auditable receipt shape that records when a tranche has crossed from implemented to `proof_passed`.

## Ownership split

- ATLAS owns semantic drift, visual proof, and the derived UI proof summary.
- Playbook may gate workflow completion on proof, but it does not redefine the receipt shape.
- `_stack` may block worker completion when proof is red or missing, but it does not author the receipt.
- Lifeline owns the receipt that references the already-derived proof facts for audit.

## Contract register

| Contract | Version | Owner | Purpose | Canonical implementation |
| --- | --- | --- | --- | --- |
| `atlas.ui.proof-summary.v1` | v1 | ATLAS root validation surface | derived completion-ready summary over semantic drift + visual proof | `ops/atlas/ui_proof/fitness.py` |
| `atlas.ui.proof-passed.receipt.v1` | v1 | Lifeline execution / receipt surface | auditable owner-repo artifact that records proof-backed tranche completion without duplicating proof truth | `src/core/ui-proof-receipt.ts` |

## Receipt shape

The receipt remains reference-first. It must not copy the full proof payload.

Required fields:

- `receipt_id`
- `emitted_at`
- `runner_version`
- `status`
- `source_repo_id`
- `tranche_id`
- `proof_summary.owner_repo_id`
- `proof_summary.summary_ref`
- `proof_summary.report_id`
- `proof_refs.semantic_report_ref`
- `proof_refs.visual_report_ref`
- `source_refs`

Optional report identifiers:

- `proof_refs.semantic_report_id`
- `proof_refs.visual_report_id`

## Emission rules

- Lifeline may emit `atlas.ui.proof-passed.receipt.v1` only when the referenced ATLAS proof summary is `completion_ready=true`.
- Lifeline must reject emission when semantic proof is not `clean`.
- Lifeline must reject emission when visual proof is not `clean`.
- Lifeline must reject emission when the proof summary owner repo does not match the requested `source_repo_id`.
- Lifeline must validate that the referenced semantic and visual proof reports are readable before writing the receipt.

## Boundary rules

- The receipt references proof facts; it does not re-author semantic or visual proof truth.
- The receipt records tranche identity (`source_repo_id`, `tranche_id`) so audit can map proof to an owner-repo adoption batch.
- Consumers that need proof details should follow the refs back to the ATLAS summary and underlying reports.
- Path-like receipt refs are normalized to forward slashes before write so Windows and POSIX receipts stay diffable.
- ATLAS-internal absolute proof refs are rewritten to stack-relative refs before write so emitted receipts stay canonical across machines.
- The `proof-pass` operator failure surface must report a failure category plus the first remediation step when receipt emission is rejected before write.

- Rule: proof-backed completion is referenced, not re-authored.
- Pattern: enforce in `_stack`, prove in ATLAS, receipt in Lifeline.
- Failure Mode: copying proof facts into Lifeline creates drift between enforcement, validation, and audit.
