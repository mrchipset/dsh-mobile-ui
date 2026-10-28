# Voice input: press-and-hold FunASR transcription

- Date: 2026-10-28
- Scope: `apps/bridge`, `apps/mobile`, `deploy/stt`
- Status: in progress

## Context

The mobile composer only accepts typed text. Users want press-and-hold voice input that records in the browser, transcribes through FunASR, and fills the draft for review before sending to DSH.

## Options

1. Browser Web Speech API — no backend, but inconsistent on iOS/Safari and no control over the model or privacy.
2. Browser records and posts audio to the Bridge; the Bridge calls a configurable STT service — recommended.
3. Browser calls FunASR directly — rejected: exposes credentials, CORS, no central limits.

## Decision

- `POST /api/transcribe` accepts raw audio with a Bearer token.
- Bridge uses an OpenAI-compatible STT adapter; `STT_BASE_URL` switches between local Docker and a LAN GPU machine.
- Default model: FunASR SenseVoiceSmall; `STT_MODEL` is configurable.
- Mobile records with `MediaRecorder`, press-and-hold, 60-second cap, fills the draft, and never auto-sends.
- LAN phones use mkcert + Vite HTTPS; the Bridge stays HTTP behind the Vite proxy.
- Audio is not persisted or logged; only size, duration, latency, provider, and error code are logged.

## Tradeoffs / risks

- `getUserMedia` requires HTTPS or localhost; plain LAN HTTP cannot support press-and-hold.
- iOS Safari records mp4/AAC; Chrome typically records webm/opus. Server-side decoding must handle both.
- A chat-only gateway does not provide STT; FunASR is a separate service.
- CPU FunASR latency grows with clip length; concurrency is limited to one by default.
- Chinese homophones can be wrong, so transcription is inserted for review, not auto-sent.
- No streaming partials in v1.

## Verification

- Pending implementation. See `doc/voice-input-design.md` for the acceptance criteria and `notes` updates after each phase.

## Follow-ups

- Confirm the pinned FunASR image and health route in this environment.
- Add ffmpeg transcoding only if FunASR cannot decode webm/mp4.
- Test iPhone Safari and Android Chrome over local HTTPS.
