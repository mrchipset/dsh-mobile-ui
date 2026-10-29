# Voice attachments: original + M4A playback persisted with prompts

- Date: 2026-10-28
- Scope: `packages/protocol`, `apps/bridge`, `.env.example`, design doc
- Status: Phase 1 + Oracle #1 remediation; mobile playback is Phase 2
## Context


A voice prompt currently persists only the transcript. Replaying it requires
storing the clip, serving it to authenticated devices, and linking one attachment.

## Options considered

1. Store only the browser clip. Rejected: WebM/Opus is not reliable on iPhone.
2. Store only a normalized copy. Rejected: loses the original recording.
3. Store original bytes plus an ffmpeg-normalized M4A/AAC copy (chosen).

## Decision

- Protocol adds `AudioAttachment`, `MessageBlock.audio`, `session.prompt.audioId`, and `PromptInput.audioId`; audio bytes never use WS.
- Migration `0002` stores both BLOBs, metadata, nullable `client_msg_id`, index, and FK cascade. WAL lives in `openDatabase`; each migration + `user_version` is one transaction.
- `POST /api/sessions/:sessionId/audio` requires Bearer auth and duration, enforces limits, and returns `201` with `{ id, mimeType, playbackMimeType, durationMs, sizeBytes, transcoded }`.
  Missing sessions use `session_gone`; invalid media maps to `unsupported_audio`.
- `FfmpegTranscoder` renders AAC in M4A via `FFMPEG_PATH`; M4A inputs are copied
  without spawning ffmpeg. Missing/failed/timeout ffmpeg falls back to original
  bytes/MIME. `AUDIO_TRANSCODE_CONCURRENCY` caps work and returns `audio_busy`.
- `GET /api/audio/:id` requires Bearer auth and serves only the playback BLOB with
  `Content-Type`, `Content-Length`, and `Cache-Control: private, max-age=86400`.
- `session.prompt` validates audio existence/session without mutation, calls
  `assertWriter`, then marks `client_msg_id` only if null or matching. Different
  prompts get `audio_already_attached`; `fold` preserves audio on user messages.
- `/health` reports cached `audio.ffmpeg` availability.

## Tradeoffs / risks

- BLOBs live in SQLite, so each clip is stored twice (original + playback).
- Accepted v1 risks: upload is auth-only until the prompt writer check; playback
  GET is authenticated but not session-scoped; abandoned uploads have no TTL/GC;
  `Cache-Control: private` is intentional for fetch + object URLs.
- If ffmpeg is unavailable, fallback playback may not work on every iPhone browser.
- Only one audio attachment per prompt is supported.

## Verification

- `pnpm exec tsc -p packages/protocol/tsconfig.json --noEmit`
- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit`
- `pnpm exec vitest run packages/protocol apps/bridge` — 14 files / 95 tests
- Real ffmpeg success (tiny WAV → M4A) and corrupt-input fallback tests ran here.
- `pnpm --filter @dsh-mobile/bridge build`
- `pnpm test` — 17 files / 119 tests
- `pnpm exec biome check packages/protocol apps/bridge`

No mobile UI, Vite, Bridge, DSH, or Docker process was started.

## Follow-ups

- Phase 2: upload on send, preview/remove pending audio, fetch/replay from messages.
- Add orphan-audio TTL cleanup and a dedicated timeout test with a controllable
  hanging ffmpeg; real-time timeout is currently covered only by code review.
- Verify real phone playback and consider session-scoped playback authorization.
