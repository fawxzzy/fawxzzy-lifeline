# Lifeline Pilot Cutover Runbook

Use this runbook when you are ready to promote the pilot surface and need a repeatable cutover check.

## Trigger

- The fixture or release candidate has been built.
- The operator surface doc and smoke check path are present.
- No active rollback condition is known.

## Action

1. Run the smoke check path:

   ```bash
   node tests/ops/lifeline-ops-smoke.mjs
   ```

2. Start the managed app with `lifeline up <manifest-path>`.
3. Confirm health with `lifeline status <app-name>`.
4. Inspect startup evidence with `lifeline logs <app-name> 20`.

## Verification

- `lifeline status` reports `App <name> is running.`
- `- healthcheck:` points at the expected local URL.
- `- health: ok (200)` is present.
- `lifeline logs` shows the startup header and managed app startup line.
- No `blockedReason` is present.

## Cutover complete

The pilot is ready only after status and log evidence agree. If the status and logs disagree, do not advance the cutover.
