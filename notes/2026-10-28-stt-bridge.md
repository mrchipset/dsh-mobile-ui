# Bridge STT foundation: configurable OpenAI-compatible adapter

- Date: 2026-10-28
- Scope: `apps/bridge`, `.env.example`
- Status: implemented + Oracle #1 remediation
## Context

The mobile composer will upload short recordings to the Bridge. The Bridge hides
the STT service, enforces auth/size/duration/concurrency limits, and returns
`{ text, language, provider, model }`. Phase 1 covers the Bridge only.

## Options considered

1. Browser calls FunASR directly. Rejected: exposes credentials, CORS, no central limits.
2. Vendor SDK in the Bridge. Rejected: Node 22 `fetch`/`FormData`/`Blob` suffice.

## Decision

- `OpenAICompatibleStt` posts multipart audio to
  `${STT_BASE_URL}/audio/transcriptions` with `file`, `model`, optional
  `language`, and `response_format=json`.
- `STT_BASE_URL` is URL-validated and switches between same-host Docker and a LAN
  GPU host without code changes; the default is `http://127.0.0.1:8000/v1`.
- Optional auth uses the name in `STT_API_KEY_ENV`; raw keys never enter config.
  A missing or empty named variable warns with the variable name only.
- `POST /api/transcribe` authenticates in a route-level `onRequest`, uses the raw
  `audio/*` parser, and accepts webm/mp4/wav/ogg/x-m4a/aac. Clients must send an
  explicit MIME; `application/octet-stream` is not parsed.
- Concurrency is per process; saturation returns 429. `auto` language is omitted
  upstream, upstream `payload.language` wins, and `/health` reports STT config.

## Tradeoffs / risks

- Duration header is advisory (ffprobe in Phase 3); concurrency is per process.
- Audio stays in memory and is never persisted or logged. Logs contain only byte
  count, duration, latency, provider, error code, and numeric upstream status.
- MIME acceptance is by header, not byte sniffing.

## Verification

- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit`
- `pnpm exec vitest run apps/bridge` — 8 files / 58 tests
- `pnpm --filter @dsh-mobile/bridge build`
- `pnpm exec biome check apps/bridge`

No real FunASR was contacted; no Bridge or DSH process was started.

## Oracle #1 remediation

- 401 now wins before body buffering: auth runs in route `onRequest`, so an
  unauthenticated oversized request returns 401, not 413.
- Oversized bodies return `413 { error: 'audio_too_large', maxBytes }`.
- Non-OK upstream responses carry `SttError.upstreamStatus`, logged numerically.
- Re-verified after remediation: tsc, 8 files / 58 tests, build, Biome.

## Follow-ups

- Phase 2: mobile recorder, press-and-hold composer, draft fill.
- Phase 3: FunASR compose/health, ffprobe duration check, real-device HTTPS smoke,
  and a cached `stt.reachable` health field.
