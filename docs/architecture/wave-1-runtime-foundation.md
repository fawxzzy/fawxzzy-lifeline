# Wave 1 runtime foundation

Wave 1 is the single-host runtime boundary for one pilot app.

## Scope

This slice stands up the smallest useful local runtime foundation:

- one app container for the pilot
- one reverse proxy boundary
- one TLS termination point
- one explicit runtime contract for ports, health, env injection, and local state

## Host contract

- App container port: `3000`
- Proxy HTTP port: `8080`
- Proxy TLS port: `8443`
- Health path: `/healthz`
- App bind host inside the container: `0.0.0.0`
- TLS is terminated at the proxy boundary, not in the app container

## Service composition

The repo-level compose file is `infra/compose.yaml`.

- `pilot` builds from `runtime/wave-1/pilot/Dockerfile`
- `proxy` uses Caddy with an internal local CA
- `proxy` forwards all traffic to `pilot:3000`
- `http://localhost:8080` redirects to `https://localhost:8443`

## Env injection

The pilot container is driven by `runtime/wave-1/pilot/pilot.env`.

Contracted variables:

- `APP_NAME`
- `APP_BIND_HOST`
- `APP_PORT`
- `APP_HEALTH_PATH`
- `APP_MESSAGE`

These values are non-secret and are expected to be overrideable locally if a pilot needs a different name or message.

## Storage assumptions

Host-local runtime state is kept under `runtime/wave-1/`.

- `runtime/wave-1/state/` for runtime state and future machine-local metadata
- `runtime/wave-1/logs/` for local log captures
- `runtime/wave-1/caddy-data/` for proxy TLS state
- `runtime/wave-1/caddy-config/` for proxy runtime config state

Generated TLS material is machine-local and must not be committed.

## Non-goals

Wave 1 does not include:

- deploy orchestration
- rollback control-plane logic
- app-specific migration flows
- multi-host scheduling
- database bootstrap
- remote control-plane behavior

## Validation

The repo-equivalent runtime config validation command is:

```bash
docker compose -f infra/compose.yaml config
```

The pilot runtime can then be brought up with the same compose file and checked at `https://localhost:8443/healthz`.

## Open assumptions

- The pilot app remains a generic health server until a real app owner replaces it.
- Local TLS uses Caddy's internal CA, so browser trust may require local CA trust setup.
- Ports `8080` and `8443` are available on the host.
