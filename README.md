# DSH Mobile UI

**English** | [简体中文](README.zh-CN.md)

A mobile-first web client for DeepSeek Harness, plus a local Node bridge that drives `dsh --profile acp` over the Agent Client Protocol (ACP).

> Status: early implementation. The core path works end to end: ACP supervision, SQLite persistence, WebSocket protocol, mobile chat, tool/plan rendering, approvals, write lease, and Light/Dark themes. MCP probing and production hardening are still in progress.

## Features

- Mobile-first React UI for sessions, streaming timelines, tool calls, plans, and notices.
- Live ACP updates over WebSocket, persisted to SQLite before fan-out.
- Single-writer lease with a handoff grace period; other devices stay read-only but keep receiving updates.
- Permission bottom sheet for tool calls; the Bridge forwards the options provided by the agent.
- Shared TypeScript and zod protocol package; unknown ACP `sessionUpdate` variants pass through.
- Light and Dark themes, persisted per device and initialized from the system preference.
- Demo mode for reviewing the UI without a running Bridge.
- MCP server status surface (read-only; live probing is planned for M7).

## Architecture

```text
Browser (React) -- WSS + JSON --> Bridge (Fastify + ws + SQLite) -- stdio ACP --> dsh --profile acp
```

The Bridge fixes the ACP session `cwd` to `WORKSPACE_ROOT` and always sends `mcpServers: []`. It is intended to run on the same machine as DSH, or inside a trusted LAN.

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/protocol` | Shared types, zod wire schemas, pure `fold` projection from ACP updates to render blocks |
| `apps/bridge` | Fastify HTTP/WS server, ACP supervisor, SQLite persistence, lease and permission routing |
| `apps/mobile` | Vite + React 19 + Tailwind v4 + shadcn-style UI |
| `doc/` | Architecture and implementation specification |
| `notes/` | Committed design decisions and tradeoffs |

## Requirements

- Node.js `>=22.13` for this repository.
- Local DSH source execution needs Node `^22.19` or `>=24`, because the DSH entry point uses `import.meta.main`.
- pnpm `10.25` or newer.
- A local DeepSeek Harness build, or an installed `dsh` binary.

## Quick start

```bash
pnpm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
# Edit .env before the first run.
pnpm dev                  # Bridge :8787 + Mobile :5173
```

Open:

- Mobile UI: <http://127.0.0.1:5173>
- Bridge health: <http://127.0.0.1:8787/health>

In the mobile Settings screen, enter the Bridge URL and `BRIDGE_SECRET`.

### Local DSH source checkout

```env
DSH_BIN=C:/path/to/node.exe   # Node ^22.19 or >=24
DSH_ARGS=["--import","tsx/esm","apps/cli/src/bin.ts","--profile","acp"]
DSH_CWD=C:/path/to/deepseek-harness
DSH_HOME=C:/Users/you/.dsh
```

### Installed `dsh`

```env
DSH_BIN=dsh
DSH_ARGS=["--profile","acp"]
DSH_CWD=C:/path/to/workspace
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRIDGE_PORT` | `8787` | HTTP and WebSocket port |
| `BRIDGE_SECRET` | required | Shared device token used by the mobile client |
| `DB_PATH` | `./data/bridge.db` | SQLite database path |
| `WORKSPACE_ROOT` | current directory | Fixed ACP `cwd` for new sessions |
| `DSH_BIN` | `dsh` | DSH executable |
| `DSH_ARGS` | `["--profile","acp"]` | JSON array of arguments passed to `DSH_BIN` |
| `DSH_CWD` | `WORKSPACE_ROOT` | Working directory for the DSH child |
| `DSH_HOME` | inherited | Optional `DSH_HOME` for the child |
| `ACP_ENABLED` | `true` | Start the ACP supervisor; `false` keeps HTTP/WS alive |
| `RETENTION_UPDATES` | `5000` | Updates kept per session |
| `LEASE_GRACE_MS` | `10000` | Writer handoff grace period |
| `PERMISSION_TTL_MS` | `180000` | Auto-cancel time for unanswered approvals |
| `LOG_LEVEL` | `info` | Pino log level |

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Bridge and Mobile together |
| `pnpm dev:bridge` | Start only the Bridge |
| `pnpm dev:mobile` | Start only the Vite dev server |
| `pnpm typecheck` | TypeScript checks for all packages |
| `pnpm test` | Protocol and Bridge unit tests |
| `pnpm build` | Build the Bridge and Mobile |
| `pnpm lint` / `pnpm format` | Biome checks and formatting |
| `pnpm smoke:acp` | Real ACP smoke test; requires `.env` and a local DSH build |

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm smoke:acp
```

Current verified scope:

- Protocol: 10 unit tests.
- Bridge: 27 unit tests, including persistence, lease transitions, and WS auth.
- Real DSH ACP smoke: initialize, list sessions, create a session, and close it.
- Mobile: Playwright at 390×844 and 320×700 in Light and Dark themes, including onboarding, catalog, chat, settings, and the permission sheet.

Not yet verified: a real model prompt/cancel round-trip, a live permission answer against DSH, physical iOS safe-area behavior, and offline PWA behavior.

## Security

- Run the Bridge on loopback or a trusted network. Put it behind TLS and a reverse proxy before exposing it.
- `BRIDGE_SECRET` is a shared secret. Do not commit `.env`.
- The Bridge never logs prompt text, absolute paths, tokens, environment variables, or full MCP URLs.
- The mobile client stores the token in `localStorage` in v1. HttpOnly cookies or per-device tokens are follow-ups.
- Device input is validated with zod before use.

## Limitations

- MCP status is read-only and currently empty on a live Bridge; probing lands with M7.
- Leases are in memory, so a Bridge restart resets write ownership.
- History starts when the Bridge first observes a session; earlier desktop messages are not backfilled.
- Production packaging, offline PWA, and code splitting are not done yet.

## Documentation

- [Architecture](doc/mobile-bridge-architecture.md)
- [Implementation specification](doc/mobile-bridge-design.md)
- [Design notes](notes/)

## README languages

GitHub always renders this English file. Gitee selects `README.zh-CN.md` automatically for Chinese browsers. Use the language switcher at the top on either platform.

## License

[MIT](LICENSE) © 2026 Zouyu
