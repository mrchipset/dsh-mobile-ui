# Full Docker deployment: Bridge + DSH + Caddy + STT

- Date: 2026-10-29
- Scope: `deploy/bridge`, `deploy/dsh`, `deploy/web`, `deploy/docker-compose.yml`, `.dockerignore`
- Status: files created and compose-validated; images not built/started

## Context

The project previously ran as host processes. ACP is stdio, so DSH must share a
container with the Bridge; phones need one HTTPS origin; the gateway must stay on
its existing Docker network.

## Options considered

1. Separate Bridge/DSH containers over HTTP. Rejected: ACP is stdio.
2. Host-bound workspace by default. Rejected: leaks host paths; empty volume is safer.
3. Caddy in front of the Bridge/static build (chosen); reuse `deploy/stt` (chosen).

## Decision

- `bridge`: Node 22 builder, npmmirror pnpm, builds the Bridge,
  `pnpm deploy --prod --legacy`, global DSH 0.2.1-rc.2 + pnpm; runtime
  ffmpeg/git/ripgrep.
- Entrypoint seeds `$DSH_HOME/profiles/acp`, copies the patch, runs
  `dsh --profile acp --version` once to install bundles, re-copies, execs the Bridge.
- DSH provider `gateaway`: `apiKeyEnv: GATEAWAY_API_KEY`,
  `http://backend:4000/v1`, model `deepseek-flash`; no inline secret.
- `web`: mobile build via Caddy `8443:443`, certs `../.certs`, `/api/*` + `/ws*`
  to `bridge:8787`. `stt`: internal only, healthchecked, cache bind.
- Volumes: `bridge-data:/data`, `dsh-home:/data/dsh`,
  `dsh-workspace:/workspace` (`WORKSPACE_PATH` override).
- Defaults avoid Docker Hub: local Node 22.23.4/Caddy 2.11.7, npmmirror, Tsinghua
  apt/PyPI. `.dockerignore` excludes secrets, state, and the STT cache.

## Tradeoffs / risks

- Bridge/DSH share a container and DB volume; DSH can read app data.
- Empty workspace by default; host bind is opt-in.
- First-start bundle install needs the npm mirror; failure disables ACP only.
- `pnpm deploy --legacy`, DSH npm layout, and bundle install are build-unverified.

## Verification

- `docker compose -f deploy/docker-compose.yml config` — passed.
- `sh -n deploy/bridge/entrypoint.sh` — passed (`alpine:latest`).
- `caddy validate` with the mounted certs — passed ("Valid configuration").
- Biome: no applicable files (Dockerfile/Caddyfile/shell).
- Probes: local Node 22.23.4/Caddy 2.11.7; npmmirror serves pnpm 10.25.0 and DSH;
  gateway network and certs exist.
- Not verified: builds, container start, ACP handshake, gateway call, web proxy,
  STT from inside the stack.

## Follow-ups

- `docker compose up -d --build`, then `/api/health`, ACP smoke, STT models, and
  one phone recording. Pin image digests; add a web healthcheck.
