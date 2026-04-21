# Runtime

This tree holds machine-local runtime assets for the Wave 1 single-host foundation.

## Wave 1 layout

- `wave-1/pilot/` is the minimal example app used to prove the runtime path.
- `wave-1/state/` is reserved for host-local runtime state.
- `wave-1/logs/` is reserved for local runtime logs and captures.
- `wave-1/caddy-data/` and `wave-1/caddy-config/` persist Caddy TLS and proxy state.

Do not commit generated TLS material, caches, or other machine-local residue here.
