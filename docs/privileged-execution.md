# Privileged execution

Lifeline now exposes a narrow read-only execution surface for capability-backed actions. The command is designed for local use only and does not grant ambient admin rights.

The canonical contract lineage for capability profiles, requests, approvals, and receipts lives in [`docs/contracts/privileged-execution-contract.md`](./contracts/privileged-execution-contract.md).
This page is the operator-facing usage guide.

## Command

```bash
pnpm lifeline execute <request-path> \
  --capability-profile <path> \
  --approval-receipt <path> \
  [--receipt-dir <path>]
```

## Flow

1. load the capability profile
2. load the privileged-action request
3. load the approval receipt
4. verify the request, approval, and capability profile match
5. either inspect the requested paths or run the dry-run command
6. emit a receipt for every attempt

## Supported execution modes

- `read_only_scan`
- dry-run command execution for approved requests

Blocked attempts still write a receipt. Rejected and expired approvals are never promoted into executable state.

## Receipt behavior

- receipts are written under `.lifeline/receipts/` by default
- the receipt ties back to `worker_id`, `assignment_id`, `stack_lock_digest`, `request_id`, and `approval_receipt_id`
- worker-originated requests may include `source_refs` pointing at `_stack` artifacts or handoff docs, and receipts echo those refs back unchanged
- read-only inspections include file metadata, not file content
- dry-run commands capture stdout, stderr, and exit code

## Example inputs

- [`examples/privileged-execution/capability-profile.json`](../examples/privileged-execution/capability-profile.json)
- [`examples/privileged-execution/read-only-scan.request.json`](../examples/privileged-execution/read-only-scan.request.json)
- [`examples/privileged-execution/read-only-scan.approval.json`](../examples/privileged-execution/read-only-scan.approval.json)
- [`examples/privileged-execution/dry-run-command.request.json`](../examples/privileged-execution/dry-run-command.request.json)
- [`examples/privileged-execution/dry-run-command.approval.json`](../examples/privileged-execution/dry-run-command.approval.json)
- [`examples/privileged-execution/dry-run-command.rejected.approval.json`](../examples/privileged-execution/dry-run-command.rejected.approval.json)
- [`examples/privileged-execution/dry-run-command.expired.approval.json`](../examples/privileged-execution/dry-run-command.expired.approval.json)
