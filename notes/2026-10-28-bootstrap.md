# Bootstrap: monorepo, protocol contract, and DSH integration choices

- Date: 2026-10-28
- Scope: repo root, `packages/protocol`
- Status: implemented

## Context

The design docs (`doc/mobile-bridge-design.md`, `doc/mobile-bridge-architecture.md`) define a single-bridge, multi-device ACP client. We need a foundation that supports a real local DSH source checkout as well as an installed `dsh` binary.

## Options

1. Build the protocol package to `dist` before every dev run — conventional, but slow feedback.
2. Source-export the protocol package (`exports` points at `src/*.ts`) — fast for tsx/Vite/Vitest; production bundling is handled later by tsdown.
3. Put protocol types inside each app — duplicates the contract and invites drift.

## Decision

- Use pnpm workspaces with TypeScript strict, Biome, and Vitest.
- Source-export `@dsh-mobile/protocol`. Consumers run through tsx or Vite, so no build step is needed for development.
- Add two small protocol extensions beyond the spec:
  - `session.create` so a mobile client can start a new chat (the spec had no creation message).
  - optional `updates` on `session.snapshot` so clients can fold incremental `session.update` messages without refetching.
- Bridge child process is configured with `DSH_BIN`, `DSH_ARGS` (JSON array), `DSH_CWD`, and `DSH_HOME`. This supports both `dsh --profile acp` and local source execution via `node --import tsx/esm apps/cli/src/bin.ts --profile acp`.
- v1 mobile auth uses the protocol `auth` message with `BRIDGE_SECRET`; HttpOnly cookie sessions remain a later hardening step.

## Tradeoffs / risks

- Source exports rely on bundler-aware resolution; a future Node-only consumer must build or alias the package.
- `session.snapshot.updates` can grow with retention. Clients should cap in-memory updates; the Bridge still prunes by `RETENTION_UPDATES`.
- `session.create` is an additive extension; unknown-message handling must remain tolerant.

## Verification

- `pnpm exec tsc -p packages/protocol/tsconfig.json --noEmit`
- `pnpm exec vitest run packages/protocol` — 10 tests pass
- `pnpm exec biome check packages/protocol`

## Follow-ups

- Implement the Bridge supervisor and mobile UI, then verify against the real DSH ACP process.
- Replace the shared-secret WS auth with per-device tokens/cookies before exposing the Bridge beyond loopback.
