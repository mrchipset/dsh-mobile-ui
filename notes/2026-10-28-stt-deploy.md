# STT readiness, paraformer default, and LAN HTTPS

- Date: 2026-10-28
- Scope: `apps/bridge`, `apps/mobile/vite.config.ts`, docs, `.env.example`
- Status: Phase 3A implemented + Oracle #3 remediation; deploy assets in `deploy/stt/**`

## Context

Phones need HTTPS for `getUserMedia`, and operators need to know whether FunASR is
reachable. `/health` previously reported only configuration, and the default model
was a literal model name rather than a stable alias.

## Options considered

1. Keep health configuration-only. Rejected: the mic cannot distinguish STT
   outage from a wiring mistake.
2. Probe `/v1/models` on every health request. Rejected: latency and upstream load.
3. Cache a bounded, best-effort readiness probe (chosen).

## Decision

- `SttReadiness` probes `${STT_BASE_URL}/models` (2 s timeout, 30 s cache, optional Bearer) and never throws; failures cache `false`.
- `/health` reports `stt.reachable` as server-side diagnostics only; mobile does
  not consume it yet. `/models` proves the server or preloaded alias is up, not
  per-model readiness. Disabled STT reports `false` without probing.
- `STT_MODEL` defaults to the FunASR alias `paraformer` (Chinese + punctuation);
  `sensevoice` remains a faster alternative.
- Vite reads repo-root `.certs/dev-cert.pem` and `.certs/dev-key.pem` when both
  exist and enables HTTPS. `.certs/` is git-ignored.
- `pnpm dev:mobile:https` runs `scripts/check-certs.mjs`, then Vite on
  `0.0.0.0:5174` with `--strictPort`; missing certs or an occupied port fail loudly.
- `.env.example` keeps `STT_ENABLED=false` until `deploy/stt/` is running. READMEs
  cover mkcert for `192.168.71.5`, iPhone trust, Android user CA, firewall, and
  the plain-HTTP microphone limitation.
- Phase 3B owns `deploy/stt/**` and `scripts/smoke-stt.ts`; this note does not duplicate them.

## Tradeoffs / risks

- A cold health check can wait up to ~2 s for the probe; cached checks are instant.
- The `paraformer` alias must exist in the deployed service; otherwise set `STT_MODEL=sensevoice`.
- Real phone trust, Safari MP4/AAC, and a live FunASR call still need manual checks.

## Verification

- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit`
- `pnpm exec vitest run apps/bridge` — 9 files / 66 tests
- `pnpm --filter @dsh-mobile/bridge build`
- `pnpm --filter @dsh-mobile/mobile typecheck`
- `pnpm --filter @dsh-mobile/mobile build`
- `pnpm test` — 14 files / 100 tests
- `pnpm exec biome check apps/bridge README.md README.zh-CN.md doc/voice-input-design.md`
- `node scripts/check-certs.mjs` — missing-cert path exits 1 with instructions (verified in an isolated copy).

No Vite or Bridge process was started; no real FunASR or phone was used.

## Follow-ups

- Phase 3B: pinned deploy bundle, smoke script, and a real `/v1/models` check.
- Install the root CA on iOS/Android, verify `https://192.168.71.5:5174`, open the
  Private-network firewall, and run a real FunASR transcript.
