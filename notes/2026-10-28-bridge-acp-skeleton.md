# Bridge: ACP supervisor, SQLite persistence, and WS protocol

- Date: 2026-10-28
- Scope: `apps/bridge`
- Status: implemented

## Context

The Bridge is the only process that owns the `dsh --profile acp` child. It must persist ACP updates before fan-out, survive child restarts, serialize writes across devices with a lease, and keep serving HTTP/WS when ACP is unavailable.

## Options

1. Use the legacy `ClientSideConnection` callback API — familiar, but loses the typed request/notification router in SDK 1.4.0.
2. Use `client().onRequest/onNotification(...).connect(stream)` — typed handlers, one `ClientContext` for outbound requests, better fit for a long-lived supervisor.
3. Spawn one DSH child per session — simpler isolation, but multiplies startup cost and breaks the single-agent design.

## Decision

- Use ACP SDK 1.4.0 `client()` over `ndJsonStream(child.stdin/stdout)`; initialize with `PROTOCOL_VERSION`, empty client capabilities, and explicit `clientInfo`.
- One supervisor process, one active-session set, exponential restart backoff (500ms → 30s, 10 attempts), and platform-specific tree kill.
- Persist first, then broadcast. `onUpdate` allocates `nextSeq` and appends inside a per-session promise chain so concurrent updates cannot reorder.
- Permission requests are routed only to the session's writer; TTL expiry resolves the SDK request as cancelled.
- `session.prompt` persists a synthetic `user_message_chunk` before calling ACP, so all devices see the user turn.
- `session.create` is additive protocol surface; new sessions always use `WORKSPACE_ROOT`, never a client-supplied cwd.
- Load `.env` from the workspace root even when pnpm runs the package with `apps/bridge` as cwd. Resolve `DB_PATH`/workspace paths from the repo root, not the package directory.
- Local DSH source execution needs Node ^22.19 (or >=24) for `import.meta.main`; `DSH_BIN` may point at a separate supported Node binary.

## Tradeoffs / risks

- Leases are in memory: a Bridge restart resets write ownership. Durable leases remain a later milestone.
- Remote session import is best-effort and only fills cold rows; message history still starts from what this Bridge observed.
- WS auth uses the shared `BRIDGE_SECRET`. Per-device tokens/cookies are deferred.
- MCP status currently returns an empty list; the probe lands with M7.
- `session.snapshot.updates` can be large; clients should cap their in-memory copy.

## Verification

- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit` — pass
- `pnpm exec vitest run apps/bridge` — 6 files / 27 tests pass
- `pnpm --filter @dsh-mobile/bridge build` — pass
- `pnpm exec biome check apps/bridge` — pass
- `pnpm smoke:acp` against the local DSH source — initialized, listed 1 remote session
- `pnpm exec tsx scripts/smoke-acp.ts --new` — created and closed a session
- Health with `ACP_ENABLED=false` — 200, `agent: "disabled"`
- Not verified: a real model prompt/cancel, tool permission round-trip, restart recovery under load, and MCP probing.

## Follow-ups

- Add an integration test for prompt → update → prompt.done through a fake ACP agent.
- Persist leases or at least document the restart behavior in the UI.
- Replace shared-secret auth with device tokens before non-loopback deployment.
