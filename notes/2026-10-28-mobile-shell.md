# Mobile shell: demo-first chat client over the Bridge protocol

- Date: 2026-10-28
- Scope: `apps/mobile`
- Status: implemented

## Context

The mobile UI must be usable before a Bridge is configured, but must also exercise the real WS protocol: session list/create/attach, streamed updates, permissions, and the single-writer lease. It needs to feel like a product on a 390×844 phone and survive 320px.

## Options

1. File-based TanStack Router with codegen vs. code-based route definitions — code-based avoids a build-time generator in the skeleton.
2. TanStack Query for conversation state vs. zustand — Query is used for `/api/health`; zustand owns the WS lifecycle, updates, and optimistic state.
3. Server-only transcript vs. optimistic user bubbles — optimistic bubble, removed when the persisted `user_message_chunk` with the same `messageId` arrives.
4. Live-only vs. a first-class demo mode — demo mode ships with seeded sessions/blocks/MCP and simulated approval, and is persisted locally.

## Decision

- Dark editorial/lab direction: near-black surfaces, lime signal accent, mono metadata, large Chinese display type. Mobile-first with safe-area padding, 44px targets, fixed composer, and a 480px desktop column.
- Routes: `/sessions`, `/sessions/$sessionId`, `/settings`; bottom nav on the two catalog screens, hidden in chat.
- The store keeps raw `StoredUpdate[]` per session and re-folds with `@dsh-mobile/protocol`. Snapshots include raw updates, so incremental updates stay correct after a reconnect.
- WS client validates every frame with zod, authenticates with the shared token, reconnects with backoff, and re-attaches the active session with its last seq.
- Demo mode seeds a full timeline (message/thought/tool/plan/notice), MCP statuses, simulated approval, and local reply/cancel behavior.
- `enterDemo()` only auto-opens the demo chat from `/` or `/sessions`; a direct `/settings` or session deep link wins.
- Add `mobile-web-app-capable` alongside the legacy Apple meta tag.

## Tradeoffs / risks

- The production bundle is ~768KB (235KB gzip); route-level splitting is deferred.
- The token lives in localStorage. HttpOnly cookie sessions remain a hardening step.
- Live MCP status is empty until M7; the UI is read-only and explains that.
- Demo data resets on reload; the demo is for review, not persistence.
- Google Fonts is a network dependency; system fallbacks are defined.
- Markdown renders without syntax highlighting.

## Verification

- `pnpm --filter @dsh-mobile/mobile typecheck` — pass
- `pnpm --filter @dsh-mobile/mobile build` — pass (chunk-size warning only)
- `pnpm exec biome check apps/mobile` — pass
- Playwright at 390×844: onboarding, demo chat, settings, permission sheet, and live Bridge connection.
- Playwright at 320×700: no document horizontal overflow; code block scrolls inside its `<pre>`; last timeline block sits 35px above the composer.
- Live Bridge: settings shows connected, 2 imported sessions load, a session attaches with a read-only snapshot.
- Console: 0 errors; deprecated `apple-mobile-web-app-capable` warning fixed by adding `mobile-web-app-capable`.
- Not verified: a real prompt/cancel round-trip, answering a live ACP permission, iOS hardware safe-area, and offline PWA behavior.

## Follow-ups

- Split the chat/settings routes and lazy-load markdown.
- Move auth to HttpOnly cookies or per-device tokens.
- M7 MCP probe wiring; add an end-to-end prompt test against a fake ACP agent.
- Add reduced-motion and screen-reader live-region passes.
