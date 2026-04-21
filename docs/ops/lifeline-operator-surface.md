# Lifeline Wave 1 Operator Surface

This is the minimum operator contract for pilot cutover. It covers the only surface the pilot should rely on: logs, health visibility, smoke checks, and rollback.

## Log contract

- Managed app output is appended under `.lifeline/logs/<app-name>.log`.
- Each `lifeline up` cycle starts with a header line in the log file.
- `lifeline logs <app-name> [line-count]` tails the log file, with `100` lines as the default.
- Log output is line-oriented and stable enough for operators to grep, tail, and attach to incident notes.

Useful signals:

- startup header: `=== lifeline up <timestamp> ===`
- app output: emitted by the managed process itself
- operator fallback: if the log file is missing, `lifeline logs` reports that explicitly

## Health contract

- `lifeline status <app-name>` is the primary health visibility command.
- Healthy state requires the supervisor, the managed child process, port ownership, and a successful health check.
- The status output always reports the local healthcheck URL, last known status, log path, manifest path, restart policy, and crash-loop state.
- `lifeline status <app-name> --proof-text` gives a compact operator brief.
- `lifeline status <app-name> --proof-gate` makes the proof brief fail closed.

Useful signals:

- `App <name> is running.` means the pilot can proceed.
- `- health: ok (200)` means the managed app is answering the healthcheck.
- `blockedReason` or `- health: managed app process not running` means cutover should stop.

## Smoke-check path

Run the disposable smoke check path from the repo root:

```bash
node tests/ops/lifeline-ops-smoke.mjs
```

That smoke path verifies:

- `up` can start the fixture app
- `status` can prove health visibility
- `logs` can surface the startup trail
- `down` can act as the rollback primitive

## Operator decision rule

- Proceed only when `status` reports running and health is `ok (200)`.
- Hold or roll back when `status` reports stopped, blocked, unhealthy, or a port owner that does not match the managed app.
- Use `logs` first when health or restart behavior is unclear.
