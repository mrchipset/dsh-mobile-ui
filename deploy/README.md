# Deployment stack (STT + Bridge/DSH + Caddy)

Runs the full project in Docker:

- `stt` — FunASR OpenAI-compatible API (`funasr-openai-api:cpu-2026-10`), internal only.
- `bridge` — DSH Mobile Bridge **and** the `dsh` CLI in one container (ACP is stdio).
- `web` — Caddy serving the mobile static build over HTTPS on `8443`.

Only `web` publishes a host port. Phones talk to Caddy; Caddy proxies `/api/*`
and `/ws*` to the Bridge. The Bridge talks to STT and to the LLM gateway.

## Prerequisites

1. Docker Engine/Desktop with Compose v2.24+ (the `env_file.required: false`
   syntax).
2. The gateway network already exists:
   ```bash
   docker network inspect llm-gateaway_default
   ```
   It must contain a service reachable as `backend:4000`. The DSH profile uses
   `http://backend:4000/v1`; the Bridge joins that network.
3. Certificates exist at the repository root:
   ```bash
   ls .certs/dev-cert.pem .certs/dev-key.pem
   ```
   Their SAN must include the LAN IP used by the phone (here `192.168.71.5`).
4. Stop the host Bridge, Vite, and host FunASR container before starting this
   stack. They collide on ACP/session state, ports, and the STT model cache.
5. Images: this host already has `node:22-bookworm-slim` (Node 22.23.4),
   `caddy:2-alpine`, and the STT image. On a fresh host either pull them or use
   the mirror overrides below.

## Configure

```bash
cd deploy
cp .env.example .env
```

Edit `deploy/.env`:

```dotenv
BRIDGE_SECRET=<long random string>
GATEAWAY_API_KEY=<gateway key>
```

`deploy/.env` is git-ignored. The key is passed as an environment variable;
the DSH profile references only `apiKeyEnv: GATEAWAY_API_KEY`, never the value.
`WORKSPACE_PATH` is optional (see below).

## Build and start

```bash
cd deploy
docker compose up -d --build
docker compose ps
```

Build/start one service at a time if needed:

```bash
docker compose up -d --build bridge
docker compose up -d web
```

The first Bridge build installs pnpm, compiles the Bridge, installs
`@deepseek-ai/dsh@0.2.1-rc.2` globally, and downloads the DSH profile bundles.
The STT container reuses `deploy/stt/models`; if the cache is empty it downloads
the paraformer checkpoint (~1.1 GB) before becoming healthy.

## Verify

```bash
cd deploy
docker compose ps                       # web running; bridge/stt healthy
docker compose logs -f bridge

# Web + API through Caddy (self-signed leaf, so -k on the host)
curl -k https://127.0.0.1:8443/api/health

# Bridge health inside the app network
docker compose exec bridge node -e "fetch('http://127.0.0.1:8787/health').then(async r=>{console.log(r.status, await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"

# STT reachability
docker compose exec bridge node -e "fetch('http://stt:8000/v1/models').then(async r=>{console.log(r.status, await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"

# ACP smoke (lists remote DSH sessions)
docker compose exec bridge node dist/scripts/smoke-acp.mjs
```

Expected Bridge health includes:

```json
"stt": { "enabled": true, "provider": "funasr", "model": "paraformer", "reachable": true }
```

Phone URL: **https://192.168.71.5:8443**. The mkcert root CA is already
installed on the phones. If it is not, install `.certs/ca.crt` (iPhone: enable
full trust; Android: user CA). Plain HTTP from a phone disables `getUserMedia`.

## Networks and ports

| Service | Host port | Internal |
| --- | --- | --- |
| web | `8443` (`WEB_PORT`) | `443` |
| bridge | none | `8787` |
| stt | none | `8000` |

`bridge` joins `app` and external `llm-gateaway_default`; `stt`/`web` join only
`app`. The gateway key never leaves the Bridge container.

## Data and workspace

| Volume / mount | Container path | Contents |
| --- | --- | --- |
| `bridge-data` | `/data` | SQLite DB + audio BLOBs (`DB_PATH=/data/bridge.db`) |
| `dsh-home` | `/data/dsh` | DSH profiles, bundles, npm config |
| `dsh-workspace` | `/workspace` | Agent working tree |
| `deploy/stt/models` | `/root/.cache` | FunASR model cache |

The workspace starts **empty**: DSH sees a blank `/workspace`, not this repo.
That is intentional for a deployable stack. To let the agent work on a host
checkout, set `WORKSPACE_PATH` in `deploy/.env`:

```dotenv
# Docker Desktop: use a path under a shared drive.
WORKSPACE_PATH=/home/you/repos/dsh-mobile-ui
```

`WORKSPACE_ROOT=/workspace` stays the same inside the container. Stop the stack
before switching; the named volume and bind path are different trees.

`docker compose down` keeps all volumes. `docker compose down -v` deletes the
database, DSH home, workspace, and the STT cache bind is untouched (it is a host
path, not a named volume).

## DSH profile

At startup `deploy/bridge/entrypoint.sh`:

1. Creates `$DSH_HOME` and `/workspace`.
2. Seeds `profiles/acp/{package.json,cordis.yml,pnpm-workspace.yaml}` if missing.
3. Copies `deploy/dsh/profiles/acp/cordis.patch.yml` into the profile.
4. On first run, calls `dsh --profile acp --version` to install profile bundles.
5. Re-copies the patch and `exec`s the Bridge.

The patch configures provider `gateaway` (`openai-completions`,
`http://backend:4000/v1`, model `deepseek-flash`) for both
`agent-default-model` and `acp`. Registry overrides are written to
`$DSH_HOME/.npmrc` and exported as `NPM_CONFIG_REGISTRY`/`npm_config_registry`
so profile bundle installs use the mirror.

If the gateway is down, the Bridge still starts and `/health` shows ACP state;
`docker compose logs bridge` shows the spawn error.

## Mirrors and troubleshooting

Defaults: local Node/Caddy images, `registry.npmmirror.com`, Tsinghua Debian apt,
Tsinghua PyPI, official CPU torch index, GitHub FunASR. Override all of them in
`deploy/.env`; see `.env.example`.

- **Docker Hub token auth / IPv6** (`failed to fetch oauth token ...
  auth.docker.io`): use locally cached images (default here) or set
  `NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim` and
  `CADDY_IMAGE=docker.m.daocloud.io/library/caddy:2-alpine`. `docker manifest
  inspect` still contacts the registry and may time out even when a local image
  is usable.
- **Debian apt fetch failures**: `APT_MIRROR`/`APT_SECURITY_MIRROR` are rewritten
  in both build stages with `Acquire::Retries=5`. Try Aliyun or USTC.
- **npm install stalls**: set `NPM_REGISTRY=https://registry.npmmirror.com` (the
  default) or another mirror; pnpm, global pnpm, global DSH, and the DSH profile
  all use it.
- **Torch download**: `TORCH_INDEX_URL` defaults to the official CPU index;
  `https://mirror.sjtu.edu.cn/pytorch-wheels/cpu` is a verified alternative.
- **Port 8443 in use**: set `WEB_PORT=8444` (phone URL changes accordingly).
- **Cert not trusted**: confirm `.certs/dev-cert.pem` has SAN
  `IP:192.168.71.5`; re-issue with mkcert/OpenSSL and restart `web`.
- **ACP fails / no bundles**: inspect `docker compose logs bridge`; delete
  `dsh-home` only if you accept re-downloading profile bundles.

## Logs and lifecycle

```bash
cd deploy
docker compose logs -f web bridge stt
docker compose restart bridge
docker compose down          # keep volumes
docker compose down -v       # destructive: DB, DSH home, workspace
```

## Build inputs

| Arg | Default | Purpose |
| --- | --- | --- |
| `NODE_IMAGE` | `node:22-bookworm-slim` | local Node 22.23.4 builder/runtime |
| `CADDY_IMAGE` | `caddy:2-alpine` | local Caddy 2.11.7 |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | pnpm + global DSH |
| `PNPM_VERSION` | `10.25.0` | pinned pnpm |
| `DSH_VERSION` | `0.2.1-rc.2` | global DSH npm package |
| `APT_MIRROR` / `APT_SECURITY_MIRROR` | Tsinghua | Debian packages |
| `STT_PYTHON_IMAGE` | `python:3.12-slim` | STT base |
| `PIP_INDEX_URL` | Tsinghua | STT Python deps |
| `TORCH_INDEX_URL` / `TORCH_VERSION` | official CPU / `2.6.0` | STT torch |
| `FUNASR_REPO` / `FUNASR_COMMIT` | GitHub / pinned | STT source |
