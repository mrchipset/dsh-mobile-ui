# Bridge STT foundation: configurable OpenAI-compatible adapter

- Date: 2026-10-28
- Scope: `apps/bridge`, `.env.example`
- Status: implemented (phase 1 of voice input)

## Context

The mobile composer will upload short recordings to the Bridge. The Bridge must
hide the STT service from phones, enforce auth/size/duration/concurrency limits,
and expose a stable `{ text, language, provider, model }` result. Phase 1 covers
only the Bridge foundation; no real FunASR call or mobile recorder is included.

## Options considered

1. Browser calls FunASR directly. Rejected: exposes credentials, CORS, no central limits.
2. Vendor SDK in the Bridge. Rejected: Node 22 `fetch`/`FormData`/`Blob` suffice.
3. Dedicated STT gateway. Deferred: one adapter is enough for v1.

## Decision

- `OpenAICompatibleStt` posts multipart audio to
  `${STT_BASE_URL}/audio/transcriptions` with `file`, `model`, `language`, and
  `response_format=json`.
- `STT_BASE_URL` switches between same-host Docker and a LAN GPU host without
  code changes; the default is `http://127.0.0.1:8000/v1`.
- Optional auth uses the name in `STT_API_KEY_ENV` and sends a Bearer header only
  when that env var has a non-empty value. Raw keys never enter config objects.
- `POST /api/transcribe` uses the existing `BRIDGE_SECRET` Bearer check, raw
  buffer parsers for `audio/*` and `application/octet-stream`, and the configured
  body limit. Accepted media types: webm, mp4, wav, ogg, x-m4a, aac.
- Concurrency is an in-process counter. When saturated the endpoint returns 429
  rather than queueing, matching the single-CPU FunASR default.
- `/health` reports `stt: { enabled, provider, model }` but never probes STT;
  STT downtime must not make the Bridge unhealthy.

## Tradeoffs / risks

- The duration header is only a guardrail; without ffprobe a client can lie.
  Phase 3 can add server-side probing if abuse becomes a concern.
- The concurrency counter is per process. Multi-process Bridge deployments would
  need a shared limiter.
- Audio is held in memory for the request and never persisted or logged. Logs
  contain only byte count, duration, latency, provider, and error code.
- MIME acceptance is by header, not byte sniffing. FunASR must decode browser formats.

## Verification

- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit`
- `pnpm exec vitest run apps/bridge` — 8 files / 47 tests
- `pnpm --filter @dsh-mobile/bridge build`
- `pnpm exec biome check apps/bridge`

No real FunASR was contacted; no Bridge or DSH process was started in this phase.

## Follow-ups

- Phase 2: mobile recorder, press-and-hold composer states, draft fill.
- Phase 3: FunASR compose/health, optional ffprobe duration check, real-device
  HTTPS smoke test, and a cached `stt.reachable` health field.
