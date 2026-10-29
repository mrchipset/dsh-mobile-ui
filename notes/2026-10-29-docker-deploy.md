# Full Docker deployment: Bridge + DSH + Caddy + STT

- Date: 2026-10-29
- Scope: `deploy/bridge`, `deploy/dsh`, `deploy/web`, `deploy/docker-compose.yml`, `.dockerignore`
- Status: built and running healthy with local images

## Context

The project previously ran as host processes. ACP is stdio, so DSH must share a
container with the Bridge; phones need one HTTPS origin; the gateway must stay on
its existing Docker network.

## Options considered

1. Separate Bridge/DSH containers over HTTP. Rejected: ACP is stdio.
2. Host-bound workspace by default. Rejected: leaks host paths; empty volume is safer.
3. Caddy in front of the Bridge/static build (chosen); reuse `deploy/stt` (chosen).

## Decision

- `bridge`: Node 22 builder, npmmirror pnpm, `pnpm deploy --prod --legacy`, global
  DSH 0.2.1-rc.2 + pnpm; runtime ffmpeg/git/ripgrep.
- Entrypoint seeds `$DSH_HOME/profiles/acp`, copies the patch, runs
  `dsh --profile acp --version` on first start, re-copies, execs the Bridge.
- DSH provider `gateaway`: `apiKeyEnv: GATEAWAY_API_KEY`,
  `http://backend:4000/v1`, model `deepseek-flash`; no inline secret.
- `web`: Caddy `8443:443`, certs `../.certs`, `/api/*` + `/ws*` -> `bridge:8787`;
  `stt` internal only with cache bind.
- Volumes: `bridge-data:/data`, `dsh-home:/data/dsh`,
  `dsh-workspace:/workspace` (`WORKSPACE_PATH` override).
- Defaults: local Node 22.23.4/Caddy 2.11.7, npmmirror, Tsinghua apt/PyPI;
  `.dockerignore` excludes secrets, state, and the STT cache.

## Build fixes found during the real build

- Apt uses HTTP Tsinghua: `node:*-slim` has no CA before apt; GPG still verifies.
- `npm_config_nodedir=/usr/local` stops node-gyp hitting nodejs.org (better-sqlite3).

## Verification

- `docker compose config`, `sh -n entrypoint.sh`, `caddy validate`, Biome — passed.
- Built `dsh-mobile-bridge:local` (`687109a1607e`, 2.29 GB) and
  `dsh-mobile-web:local` (`830369a6da8c`, 94 MB); STT reused `606fa61fc60f`.
- `docker compose ps`: `stt`/`bridge` healthy, `web` up on `0.0.0.0:8443`.
- `/api/health` (Caddy): 200, `agent: ready`, `stt.reachable: true`,
  `audio.ffmpeg: true`; direct Bridge health is identical.
- Gateway from Bridge: HTTP 200 (`/v1/models` with the env key).
- `dsh --profile acp --dump-config`: `gateaway`, `apiKeyEnv: GATEAWAY_API_KEY`,
  `http://backend:4000/v1`, `deepseek-flash`; base/acp-app bundles loaded.
- `smoke-acp` exited 0 (0 remote sessions); STT `paraformer.ready=true`;
  `https://192.168.71.5:8443` returned 200. Old host `stt-stt-1` stopped.
- Not verified: a real LLM prompt/phone recording; host Bridge/Vite still run.
  Profile bundles resolve from the global DSH install, so no profile `node_modules`
  is created and the entrypoint re-runs `dsh --version` on each restart.

## Follow-ups

- Run a real ACP prompt and a phone recording; then stop host Bridge/Vite.
- Pin image digests; add a web healthcheck; avoid repeat profile init.
