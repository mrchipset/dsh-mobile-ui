# Voice attachments: original + M4A playback persisted with prompts

- Date: 2026-10-28
- Scope: `packages/protocol`, `apps/bridge`, `.env.example`, design doc
- Status: Phase 1 (protocol + Bridge) implemented; mobile playback is Phase 2
## Context

A voice prompt currently persists only the transcript. Replaying it requires
storing the clip, serving it to authenticated devices, and linking one attachment.

## Options considered

1. Store only the browser clip. Rejected: WebM/Opus is not reliable on iPhone.
2. Store only a normalized copy. Rejected: loses the original recording.
3. Store original bytes plus an ffmpeg-normalized M4A/AAC copy (chosen).

## Decision

- Protocol adds `AudioAttachment`, `MessageBlock.audio`, and optional
  `session.prompt.audioId`. Audio bytes never travel over WS or snapshots.
- Migration `0002_audio_attachments.sql` stores both BLOBs, metadata, nullable
  `client_msg_id`, a `(session_id, created_at)` index, and FK cascade. The runner
  applies 0001 then 0002 and advances `user_version` to 2.
- `POST /api/sessions/:sessionId/audio` uses the existing Bearer check, raw
  `audio/*` parser, MIME allowlist, `STT_MAX_BYTES`, and `STT_MAX_DURATION_MS`.
  It returns `201` with `{ id, mimeType, playbackMimeType, durationMs, sizeBytes }`.
- `GET /api/audio/:id` requires Bearer auth and serves only the playback BLOB with
  `Content-Type`, `Content-Length`, and `Cache-Control: private, max-age=86400`.
- `FfmpegTranscoder` renders AAC in M4A (`-vn -c:a aac -b:a 64k -movflags
  +faststart`) via `FFMPEG_PATH`. Missing/failed/timed-out ffmpeg falls back to
  the original bytes and MIME; temp files are always removed and no audio or
  full paths are logged.
- `session.prompt` verifies the audio's session, marks `client_msg_id`, and adds
  metadata to the synthetic `user_message_chunk`. Unknown or cross-session IDs
  fail with `audio_not_found` / `audio_session_mismatch` before ACP. `fold`
  preserves the metadata across user chunk merges.

## Tradeoffs / risks

- BLOBs live in SQLite, so each clip is stored twice (original + playback).
- If ffmpeg is unavailable, the fallback may not play on every iPhone browser.
- Unused uploads from failed/abandoned sends are not garbage-collected yet.
- Only one audio attachment per prompt is supported by the schema and UI plan.

## Verification

- `pnpm exec tsc -p packages/protocol/tsconfig.json --noEmit`
- `pnpm exec tsc -p apps/bridge/tsconfig.json --noEmit`
- `pnpm exec vitest run packages/protocol apps/bridge` — 14 files / 88 tests
- `pnpm --filter @dsh-mobile/bridge build`
- `pnpm exec biome check packages/protocol apps/bridge`

No real ffmpeg run was required; tests use a fake transcoder and the unavailable
ffmpeg fallback. No mobile UI, Vite, Bridge, DSH, or Docker process was started.

## Follow-ups

- Mobile: upload on send, preview/remove pending audio, fetch/replay from messages.
- Add orphan-audio TTL cleanup and consider a size/count budget.
- Verify real webm and m4a recordings through host ffmpeg and on physical phones.
