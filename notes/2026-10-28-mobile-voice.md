# Mobile press-and-hold voice input

## Context

The Bridge already owns `POST /api/transcribe` and `GET /api/health` with `stt.enabled`. Phase 2 records
a short clip, sends raw audio with the existing bearer token, inserts the transcript into the draft,
and never sends automatically.

## Options considered

1. **Browser `SpeechRecognition`.** Rejected: inconsistent support and no FunASR/Bridge contract.
2. **Live streaming transcription.** Out of scope; batching keeps the Bridge contract simple.
3. **`MediaRecorder` -> raw Blob -> Bridge (chosen).** Matches the accepted design; audio stays in memory.
4. **Composer-only fake UI.** Rejected; the real recorder must exist, with demo mode simulating it.

## Decision

- `useVoiceRecorder` owns `idle | requesting | recording | transcribing | error`, the 60s cap, the
  300ms discard threshold, elapsed time, input level, and cleanup. It requests mono audio with echo
  cancellation, noise suppression, and AGC.
- MIME order is `audio/webm;codecs=opus` -> `audio/mp4;codecs=mp4a.40.2` -> `audio/mp4`; every Blob
  gets that explicit type. Tracks, recorder, and `AudioContext` are released on stop/cancel/unmount
  and `pagehide`.
- `stt.ts` sends the store token, `Content-Type: blob.type`, `X-Audio-Duration-Ms`, and
  `X-Audio-Language: zh`; Bridge error bodies map to local Chinese copy. Audio/transcript are not logged.
- Health comes from `/api/health`: `stt.enabled === false` disables the mic with a retry row; a
  missing/failed response is “unknown”, leaves the mic available, and offers retry.
- Composer adds a 44px mic beside send. Pointer hold uses capture, blocks the context menu and touch
  scrolling, and releases to transcribe. Keyboard/AT clicks (`detail` 0) toggle; pointer clicks are
  suppressed to avoid a double toggle.
- The recording bar shows timer and level with cancel/stop. Transcribing replaces the actions with a
  spinner and blocks a second recording. Transcripts insert at the cursor with spacing preserved,
  then focus the textarea. Sending remains explicit.
- Demo mode never calls `getUserMedia` or STT; it simulates the bar and a labeled canned Chinese
  transcript.
- Existing disconnected, running, lease, and permission messages remain; the mic is disabled with a
  matching reason. `ChatScreen` observes composer resizes so the last timeline block stays visible.

## Tradeoffs / risks

- Pointer clicks are hold gestures; only keyboard/AT clicks toggle. A sub-300ms tap during the
  permission request cancels silently rather than showing the “too short” message.
- Missing `stt` health (older Bridge) is treated as unknown, not disabled. Audio is memory-only; no
  playback, history, or partial transcript. Demo text is fixed.
- Real iPhone/Android recording over local HTTPS and hardware permission denial are Phase 3.
## Verification

- `typecheck`, `build`, and `biome check apps/mobile` pass (Vite emits only its chunk-size warning).
- Playwright at 390×844 and 320×700, light/dark demo: 44px mic, recording bar, transcript insertion
  and focus, no auto-send (article count unchanged), cancel without insertion, keyboard start/stop,
  300ms discard, zero horizontal overflow, last block visible, zero console errors, zero demo mic calls.
- Fake mic with mocked WS/health/transcribe: real Blob was `audio/webm;codecs=opus`; request carried
  bearer, duration, and `zh`; transcript landed in the draft; cancel made no new transcribe request.
- Health false disables the mic + retry; missing/503 shows unknown and allows mic/retry. Playwright
  clock confirmed the 60s cap switches the bar to 1:00 / transcribing.
- Screenshots: `C:\Users\Zouyu\AppData\Local\Temp\opencode\voice-shots`.
## Follow-ups

- Phase 3: verify local HTTPS, iOS MP4/AAC, Android Chrome, real FunASR, and hardware permission denial.
- Consider a retry action attached to transcription errors and a settings detail for STT provider.
