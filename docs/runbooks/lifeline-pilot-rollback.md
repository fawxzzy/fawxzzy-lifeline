# Lifeline Pilot Rollback Runbook

Use this runbook when the pilot must be stopped, reverted, or fenced off from further cutover.

## Trigger

- Health fails.
- The app enters `blocked`, `unhealthy`, or `crash-loop`.
- `lifeline status` shows a port owner that is not the managed app.
- A smoke check fails after deploy.

## Action

1. Stop the managed app:

   ```bash
   lifeline down <app-name>
   ```

2. Confirm the app is no longer running:

   ```bash
   lifeline status <app-name>
   ```

3. Inspect the latest log tail if the stop did not behave cleanly:

   ```bash
   lifeline logs <app-name> 50
   ```

## Verification

- `lifeline down` exits successfully.
- `lifeline status` reports `App <name> is stopped.`
- The health line says the managed app process is not running.
- The port is no longer owned by the managed app.

## Recovery after rollback

- Fix the manifest, environment, or runtime cause first.
- Re-run the smoke check path before attempting another `lifeline up`.
- Do not retry cutover until the rollback cause is understood.
