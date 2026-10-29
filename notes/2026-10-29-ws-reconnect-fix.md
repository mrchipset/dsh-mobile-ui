# WebSocket reconnect could stick at “重连中”

- Date: 2026-10-29
- Scope: `apps/mobile`
- Status: implemented

## Context

The explicit reconnect action set the store status to `connecting` and called `BridgeClient.connect()`. That method returned immediately when an existing socket was still `CONNECTING` or `OPEN`, even if authentication had never completed. No new socket was opened and no auth message was resent, so the UI could remain in “重连中” forever.

## Options

1. Make the store call `disconnect()` before every explicit reconnect. This fixes the retry button but leaves `BridgeClient.connect()` unsafe for boot/online/reconnect callers.
2. Make `BridgeClient.connect()` own the lifecycle: invalidate the old generation, detach handlers, close the stale socket, clear the retry timer, reset attempts, and open a fresh socket.
3. Add a separate `forceReconnect()` API and rely on callers to choose it.

## Decision

Choose option 2. `connect()` is now idempotent and always creates a fresh authenticated attempt. `online`/`visibilitychange` also force a reopen when a socket is open but never reached `ready`.

## Tradeoffs / risks

- A redundant `connect()` now closes an otherwise healthy socket and re-authenticates; this is correct for an explicit reconnect and infrequent.
- Automatic close events still use the existing backoff path; the fix does not change normal retry timing.

## Verification

- New `apps/mobile/src/lib/ws-client.test.ts` regression: an OPEN but unauthenticated socket is torn down; a second socket is created, receives auth, and reaches `ready`.
- `pnpm --filter @dsh-mobile/mobile typecheck` — pass
- `pnpm test` — 21 files / 149 tests
- `pnpm --filter @dsh-mobile/mobile build` — pass
- Docker `web` image rebuilt and restarted; Caddy `/api/health` remains 200.
- Physical phone reconnect after a Bridge restart: recommended user acceptance.

## Follow-ups

- Add an integration test that restarts the Bridge container while a browser socket is connected.
- Revisit heartbeat/close timing for mobile background tabs.
