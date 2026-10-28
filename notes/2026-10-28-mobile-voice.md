# Mobile press-and-hold voice input
## Context

The Bridge owns `POST /api/transcribe` and health `stt.enabled`. The client records, uploads with the
existing bearer, inserts the transcript into the draft, and never sends automatically.
## Options considered

1. **Browser `SpeechRecognition`.** Rejected: inconsistent support and no FunASR/Bridge contract.
2. **Live streaming.** Out of scope; batching keeps the Bridge contract simple.
3. **`MediaRecorder` -> raw Blob -> Bridge (chosen).** Matches the design; audio stays in memory.
## Decision

- `useVoiceRecorder` owns `idle | requesting | recording | transcribing | error`, 60s cap, 300ms
  threshold, elapsed time, level, and cleanup; mono audio uses AEC, noise suppression, and AGC.
- MIME order is `audio/webm;codecs=opus` -> `audio/mp4;codecs=mp4a.40.2` -> `audio/mp4`; the Blob
  type is explicit. Tracks, recorder, and `AudioContext` release on stop/cancel/unmount/pagehide.
- `stt.ts` sends the token, `Content-Type`, `X-Audio-Duration-Ms`, and `Accept`; audio/transcript are
  not logged. Health false disables the mic with retry; unknown health keeps the mic and offers retry.
- Composer adds a 44px mic. Touch/pen holds use capture, block context/touch gestures, release to
  transcribe; mouse clicks and Space/Enter toggle. The bar shows timer/level with cancel/stop.
- Transcripts insert at the caret/selection with spacing preserved, focus the textarea, and never
  auto-send. Demo mode simulates the bar/transcript without `getUserMedia` or STT.
- Disconnected, running, lease, and permission messages remain; the mic is disabled with matching
  reasons. `ChatScreen` observes composer resizes so the last timeline block stays visible.
## Oracle #2 remediation

- Transcribe now has an 85s `AbortController` timeout; abort maps to `stt_timeout`. `cancel()` during
  transcribing aborts the fetch/demo timer and returns to idle; the bar exposes “取消转写”.
- The mic uses `disabled={micDisabled && !voiceBusy}` (matching `aria-disabled`), so pointer release
  lands after a lease/reconnect change; unavailable idle states keep muted styling.
- Mouse `pointerdown` no longer starts a hold; its click toggles. Touch/pen keeps press-and-hold.
- Track `ended` cancels with “麦克风连接已中断”; hidden visibility tears down like pagehide.
- Dropped `X-Audio-Language`; unknown 500s map to `stt_upstream_error`; `audio_too_large` surfaces the
  server limit. Draft edits clear stale voice errors via `reset()`. Health re-probes on ready after a
  reconnect.
- Pure `transcript.ts` / `voice-state.ts` helpers and three test files cover caret/selection/spacing,
  body-code precedence, 401/400, empty text, non-JSON, 500, timeout abort, no language header, short
  clips, and cancel-before-upload.
## Tradeoffs / risks

- **One-hand cancel limitation:** a one-finger hold cannot tap the bar’s cancel; keyboard/click toggle
  users can. Slide-away-to-cancel is a follow-up.
- Audio is memory-only: no playback, history, partial transcript, or language picker. Demo text is fixed.
- Phase 3 will update the design doc’s `paraformer` alias, `/v1/models` reachability, and click/hold
  wording, then verify iOS/Android HTTPS and hardware permission denial.
## Verification

- `typecheck`, `build`, `biome check apps/mobile vitest.config.ts`, and `pnpm test` pass: 13 files /
  92 tests (24 new mobile tests across three files).
- Playwright 390×844 and 320×700, light/dark: touch hold inserts the demo transcript, mouse click
  toggles, cancel inserts nothing, no auto-send (article count unchanged), 44px mic, no overflow,
  last block visible, zero console errors, zero demo mic calls.
- Slow mocked live response: transcribing cancel aborts, returns idle, leaves send usable, zero
  alerts. Fake-mic success sends bearer + explicit WebM + duration with no language header.
- Health re-probe confirmed after WS reconnect; track `ended` shows the clear error and tears down;
  hidden visibility clears recording. Screenshots: `C:\Users\Zouyu\AppData\Local\Temp\opencode\voice-shots`.
## Follow-ups

- Phase 3: local HTTPS, iOS MP4/AAC, Android Chrome, real FunASR, hardware permission denial.
- Consider slide-away cancel for one-hand holds and a retry action on transcription errors.
