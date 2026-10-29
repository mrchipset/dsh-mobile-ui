# Mobile voice attachment preview, upload, and sent playback
## Context

The Bridge stores one authenticated audio attachment per prompt. The mobile client reviews/removes a
clip before an explicit send and replays it from the sent message without exposing raw audio URLs.

## Options considered

1. **Upload when recording stops.** Rejected: the clip must be removable before send.
2. **Bare `<audio src="/api/audio/:id">`.** Rejected: playback is Bearer-authenticated.
3. **Commit audio when recording stops.** Rejected: a failed transcript would leave new audio with an
   old draft.

## Decision

- The recorder exposes `onClip`; the composer holds the candidate in a ref and commits clip +
  transcript together only when transcription succeeds. Failed, empty, or cancelled attempts keep
  the previous pending pair.
- The pending chip uses a local object URL with play/pause, duration, progress, and remove. Remove
  clears only audio; text remains sendable.
- Send uploads first with Bearer, explicit MIME, and duration, then calls `session.prompt` with
  `audioId` and a stable `clientMsgId`.
- Upload failure keeps the chip/draft. A later WS prompt error restores `{ text, audioId,
  clientMsgId }`; retry reuses both IDs and does not re-upload.
- Sent player fetches the playback Blob on first play, creates an object URL, caches refcounted URLs,
  and releases them on unmount. No unauthenticated media URL is used.
- The warning shows only for `transcoded:false` fallback copies (`audio/webm`, `audio/ogg`, ADTS
  `audio/aac`). MP4/M4A playback is already playable and is not warned. The warning is session-memory
  only after reload.
- Demo mode uses a local WAV, never uploads/fetches, and keeps sent demo audio until demo reset;
  pending demo audio is released on replace/remove.
- Phase 2 remediation also added 40 s upload / 20 s playback timeouts with unmount aborts, media-error
  source clearing + retry, format-specific media copy, “再点一次播放” for blocked async play, and a
  disabled mic during transcription (cancel remains in the bar).

## Tradeoffs / risks

- `transcoded` metadata is not in `MessageBlock.audio`; a reloaded history cannot show the warning.
- Remote playback fetches on first tap; iOS may still require a second tap even with the retained URL.
- No seeking; progress/duration only. The demo WAV is a local tone, not a recording.
- Inherited v1 risks: upload auth-only until prompt writer validation; playback not session-scoped;
  abandoned uploads have no GC.

## Verification

- `typecheck`, `build`, and `biome check apps/mobile` pass.
- `pnpm test` — 19 files / 147 tests pass, including warning gating, upload 404/415/missing
  `transcoded`, playback 5xx/timeout, remote URL acquire/release/abort, demo release, and
  failed/empty/cancelled transcript settlement.
- Playwright 390×844 and 320×700, light/dark demo: preview play/pause/remove, transcript replacement,
  sent local player, 44px controls, no network audio calls, no overflow, zero console errors.
- Mocked live Bridge/fake mic: upload headers/body verified, prompt carried `audioId` and stable
  `clientMsgId`, 0 playback GETs before first play and 1 after, play/pause, 404 retry, webm warning;
  upload 500 kept pending with no prompt; a later `lease_held` error restored the pair and retry
  reused the same audio/client IDs without another upload. The mic was disabled while transcribing.
- Screenshots: `C:\Users\Zouyu\AppData\Local\Temp\opencode\voice-shots`.
## Follow-ups

- Final real Bridge + FunASR + physical iPhone/Android E2E; persist `transcoded` if the warning must
  survive reloads.
