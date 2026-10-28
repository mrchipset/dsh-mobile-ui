# STT readiness, paraformer default, and LAN HTTPS

- Date: 2026-10-28
- Scope: `apps/bridge`, `apps/mobile/vite.config.ts`, docs, `.env.example`
- Status: Phase 3A implemented; Phase 3B deploy assets live in `deploy/stt/**`

## Context

Phones need HTTPS for `getUserMedia`, and the mobile client needs to know whether
FunASR is actually available. `/health` previously reported only configuration,
and the default model was a literal FunASR model name rather than a stable alias.

## Options considered

1. Keep health configuration-only. Rejected: the mic cannot distinguish STT
   outage from a wiring mistake.
2. Probe `/v1/models` on every health request. Rejected: latency and upstream load.
3. Cache a bounded, best-effort readiness probe (chosen).

## Decision

- `SttReadiness` probes `${STT_BASE_URL}/models` with a ~2 s timeout and ~30 s
  cache, reusing the optional STT API key. It never throws; failures cache `false`.
- `/health` reports `stt.reachable`. When `STT_ENABLED=false` it reports `false`
  and does not probe.
- `STT_MODEL` defaults to the FunASR alias `paraformer` (Chinese + punctuation);
  `sensevoice` remains a faster alternative.
- Vite reads the repo-root `.certs/dev-cert.pem` and `.certs/dev-key.pem` when both
  exist and enables HTTPS. `pnpm dev:mobile:https` serves `0.0.0.0:5174`; `/api`
  and `/ws` keep proxying to the Bridge. `.certs/` is git-ignored.
- READMEs document mkcert for `192.168.71.5`/`<LAN_IP>`, iPhone full trust,
  Android user CA, the `5174` firewall rule, and that plain LAN HTTP disables mic.
- Phase 3B owns `deploy/stt/**` (pinned FunASR image/compose/healthcheck/cache) and
  `scripts/smoke-stt.ts`; this note does not duplicate their contents.

## Tradeoffs / risks

- A cold health check can wait up to ~2 s for the probe; cached checks are instant.
- `/models` readiness proves reachability, not transcription quality or model load.
- The `paraformer` alias must exist in the deployed FunASR service; otherwise set
  `STT_MODEL=sensevoice`.
- Without both cert files Vite stays HTTP, preserving existing local workflows.
- Real phone trust, Safari MP4/AAC, and a live FunASR call still need manual checks.

## Verification

- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit`
- `pnpm exec vitest run apps/bridge` — 9 files / 65 tests
- `pnpm --filter @dsh-mobile/bridge build`
- `pnpm --filter @dsh-mobile/mobile typecheck`
- `pnpm --filter @dsh-mobile/mobile build`
- `pnpm test` — 14 files / 99 tests
- `pnpm exec biome check apps/bridge apps/mobile/vite.config.ts vitest.config.ts`

No Vite or Bridge process was started; no real FunASR or phone was used.

## Follow-ups

- Phase 3B: pinned deploy bundle and `scripts/smoke-stt.ts`.
- Install the root CA on iOS/Android, verify `https://<LAN_IP>:5174`, open the Private-network firewall, and run a real FunASR transcript.
