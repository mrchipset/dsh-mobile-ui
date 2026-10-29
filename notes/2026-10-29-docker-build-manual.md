# Docker build manual and all-in-one GateAway bootstrap

- Date: 2026-10-29
- Scope: `deploy/BUILD_MANUAL.md`, `deploy/bootstrap.ps1`, compose, `.env.example`, `.gitignore`
- Status: files created and validated; script not executed

## Context

The all-in-one stack needed documented image builds, tenant/client-key creation,
model registration, and a fresh-vs-existing Postgres choice. Manual steps risked
leaking keys or rotating the DB password/master key under an existing volume.

## Options considered

1. Manual-only instructions. Rejected: repetitive and error-prone.
2. Always create a fresh Gateway DB. Rejected: breaks existing keys/audit data.
3. Manual plus idempotent PowerShell 7 bootstrap with `-ExistingGateway` (chosen).

## Decision

- Compose volume is selectable: `GATEWAY_PGDATA_VOLUME` / `GATEWAY_PGDATA_EXTERNAL`.
  Fresh: `dsh-mobile-gateway-pgdata`/`false`; existing: `llm-gateaway_pgdata`/`true`.
- `./secrets` is mounted read-only into `backend` and `bridge` so generated files
  are visible on the host.
- `bootstrap.ps1` generates bridge/master/Postgres secrets, writes
  `deploy/secrets/*` and `deploy/.env`, builds images, starts GateAway, waits for
  `/readyz`, creates/reuses tenant `dsh-mobile`, creates a one-time client key,
  registers `deepseek-flash`, then starts `stt/bridge/web` and waits for health.
- `-ExistingGateway` requires the matching Postgres password/master key, reuses
  client keys/audit data, and skips key creation when `GATEAWAY_API_KEY` exists.
- `-Force` stops both old stacks and recreates only the fresh Gateway DB volume
  before regenerating secrets; app volumes are kept.
- `-SkipBuild` requires all images; `-GatewayRepo` overrides the checkout.
- `BUILD_MANUAL.md` documents architecture, variants, manual API steps, key
  files, rotation, verification, and troubleshooting.

## Tradeoffs / risks

- `-Force` destroys `dsh-mobile-gateway-pgdata`; use `-ExistingGateway` to keep
  existing Gateway data.
- Existing mode cannot recover a missing Postgres password/master key; the script
  fails rather than guessing.
- Secrets are stored unencrypted but git-ignored on the host; the client key
  plaintext appears only in the creation response and saved file.
- Only PowerShell 7 automation is provided; Linux users follow the manual.
- The script waits up to ~10 minutes for Bridge/STT; an empty STT cache is slower.

## Verification

- `compose config --quiet` with the current `.env` (external) and the fresh
  override (`dsh-mobile-gateway-pgdata`/`false`) - both passed; no secrets printed.
- PowerShell parser OK; `git check-ignore` confirms `.env`/`secrets/*` ignored.
- Not verified: script execution, builds, tenant/key/model creation, container
  start, Gateway readiness, real prompt. No containers were changed.

## Follow-ups

- Run `pwsh deploy/bootstrap.ps1` with `GATEWAY_DEEPSEEK_API_KEY`, verify
  `/readyz`, `/v1/models`, Bridge `/api/health`, and a phone recording; test an
  existing-gateway switch and consider a bash bootstrap.
