# Demo mode must not hijack route navigation

- Date: 2026-10-28
- Scope: `apps/mobile`
- Status: implemented

## Context

`enterDemo()` set `pendingNavigation` to the primary demo session on every boot. That made `/sessions` render the chat immediately and made the catalog header (including the new theme switch) unreachable. Direct `/settings` links were also overridden during page load.

## Options

1. Keep auto-navigation and special-case only `/settings` — still breaks the catalog and deep links.
2. Navigate only when the user explicitly clicks “先看看演示模式” — requires threading a flag through every caller.
3. Never navigate from `enterDemo()`; let the router decide where demo mode renders.

## Decision

Choose option 3. Entering demo mode only seeds data and switches `mode`; `pendingNavigation` stays null. The onboarding button therefore lands on the demo catalog, from which the user picks a session. `/settings` and session deep links remain intact.

## Tradeoffs / risks

- “先看看演示模式” no longer jumps directly into the richest chat; the catalog is now the landing surface. This is preferable for discoverability and matches the catalog-first navigation model.
- If the product later wants a one-click demo chat, add an explicit button that navigates after `enterDemo()`.

## Verification

- `pnpm --filter @dsh-mobile/mobile typecheck` — pass
- Playwright: `/sessions` stays on the catalog after boot; catalog theme switch reaches Light/Dark; `data-theme`, `meta[theme-color]`, and persisted `dsh-mobile.theme` update; reload keeps the chosen theme.
- Playwright at 320×700: `docScrollWidth === 320`, no overflowing elements.
- Screenshots: `.playwright-mcp/theme-light-chat-390.png`, `theme-dark-catalog-390.png`, `theme-dark-catalog-320.png`.
- Not verified: a live Bridge session in both themes (the Bridge was intentionally stopped during this check).

## Follow-ups

- Add an explicit “打开示例对话” action to the demo catalog if direct entry is desired.
