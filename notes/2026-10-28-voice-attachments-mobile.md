# Mobile voice attachment preview, upload, and sent playback

## Context

The Bridge now stores one audio attachment per prompt with authenticated upload/playback. The mobile
client reviews/removes a clip before an explicit send, and replays it without exposing raw audio URLs.

## Options considered

1. **Upload when recording stops.** Rejected: the user should be able to remove the clip, and the
   Bridge should not retain abandoned takes.
2. **Use a bare `<audio src="/api/audio/:id">`.** Rejected: playback is Bearer-authenticated and
   must not put the API URL into the media element.
3. **Only normalized audio.** Rejected: the Bridge already stores original + playback; the client
   needs the upload response metadata and a local fallback warning.

## Decision

- The recorder exposes `onClip`; `onTranscript` now **replaces** the draft and keeps the clip.
  Composer state holds at most one pending `{ clip, uploaded? }`.
- `lib/audio.ts` owns upload (`POST /api/sessions/:sessionId/audio`, Bearer, explicit MIME, required
  duration), authenticated playback fetch, metadata/local-audio caches, object-URL ref counting, and
  a small local demo WAV.
- The composer shows a pending chip with local play/pause, progress, duration, remove, and a clear
  demo badge. Send uploads first, then sends `session.prompt` with `audioId`; upload failures keep
  the draft/chip and retry with the send button. A prompt failure after upload keeps the uploaded id.
- Sent `MessageBlock.audio` renders a compact player. The first play fetches the playback blob with
  Bearer, creates an object URL, and plays; no unauthenticated `<audio src>` exists. URLs are cached
  per audio id and released on unmount. 401/404/network failures are inline and retryable.
- `transcoded: false` shows “播放副本保留原始格式，iPhone 兼容性可能有限” without blocking send.
- Demo mode creates a local WAV, registers local metadata/blob, and renders the sent player without
  any upload or playback request. Store demo turns include the same audio metadata/id.

## Tradeoffs / risks

- The `transcoded` warning depends on the client upload-meta cache; historical blocks after reload
  cannot show it because `MessageBlock.audio` lacks that field.
- Remote playback is fetched after the first tap; on iOS the async fetch may need a second tap if the
  browser drops the user activation.
- No seeking; the player shows progress and duration only. The demo WAV is an 8 kHz tone, not audio.
- Inherited v1 risks: upload is auth-only until prompt writer validation, playback is not
  session-scoped, and abandoned uploads have no GC.

## Verification

- `typecheck`, `build`, and `biome check apps/mobile` pass.
- `pnpm test` — 18 files / 131 tests pass, including audio upload/playback/error and demo WAV tests.
- Playwright 390×844 and 320×700, light/dark demo: pending preview play/pause, 44px remove/play,
  transcript replaces prior text, remove keeps text, sent local player, no network audio calls, no
  horizontal overflow, zero console errors.
- Mocked live Bridge/fake mic: upload authorization/MIME/duration/body verified, prompt carried
  `audioId`, 0 playback GETs before first play and 1 after, play/pause worked from an object URL,
  `audio-missing` rendered the 404 retry, and a 500 upload kept the pending chip with no prompt;
  retry then sent `audio-retry`. `transcoded:false` warning rendered.
- Screenshots: `C:\Users\Zouyu\AppData\Local\Temp\opencode\voice-shots`.
## Follow-ups

- Run the final real Bridge+FunASR+device E2E (including iPhone playback and async first tap).
- Persist `transcoded` client-side or add it to historical message metadata if warnings must survive
  reloads.
