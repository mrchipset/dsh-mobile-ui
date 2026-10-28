# Voice input design (FunASR + Bridge)

- Date: 2026-10-28
- Status: accepted for implementation
- Scope: `apps/bridge`, `apps/mobile`, `deploy/stt`, docs

## 1. Goal

Add a press-and-hold voice input to the mobile composer. The browser records a short clip, the Bridge transcribes it through a configurable FunASR/OpenAI-compatible service, and the transcript is inserted into the existing draft. Sending remains an explicit user action through the existing `session.prompt` path.

Non-goals for v1:

- No live/partial transcript streaming.
- No automatic sending.
- No audio persistence or playback history.
- No public-internet security hardening.
- No native app shell.

## 2. Confirmed constraints

- Backend: FunASR, deployable on the same host (Docker) or a LAN GPU machine.
- UX: press-and-hold to record; release to transcribe; fill the input box.
- Devices: Android and iPhone.
- Network: LAN access from phones.
- Recording limit: 60 seconds.
- Model: SenseVoiceSmall default; model configurable.
- Security: existing Bearer token remains; no new auth hardening in v1.

## 3. Critical browser constraint: secure context

`getUserMedia` and `MediaRecorder` are only available in a secure context:

- `https://...` works.
- `http://localhost` works.
- `http://192.168.x.x` does not expose `navigator.mediaDevices`.

Ignoring production security does not remove this browser requirement. For Android + iPhone, use local HTTPS:

1. `mkcert -install`
2. `mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem <LAN_IP> localhost 127.0.0.1`
3. Vite reads `.certs/` and serves `https://<LAN_IP>:5173`.
4. Phone installs the mkcert root CA; iPhone also enables full trust.
5. Vite proxies `/api` to `http://127.0.0.1:8787` and `/ws` to `ws://127.0.0.1:8787`.

The Bridge remains HTTP and is reached only through the Vite proxy. `.certs/` must be git-ignored.

Android-only alternative for quick testing: `adb reverse tcp:5173 tcp:5173` and `adb reverse tcp:8787 tcp:8787`, then open `http://localhost:5173`. This is not the chosen path because iPhone must work too.

## 4. Architecture

```text
Phone (HTTPS)
  getUserMedia -> MediaRecorder -> Blob (webm/opus or mp4/aac)
        |
        | POST /api/transcribe (Bearer, raw audio)
        v
Bridge (Fastify)
  auth -> MIME/size/duration checks -> STT adapter
        |
        | OpenAI-compatible /v1/audio/transcriptions
        v
FunASR service (same host 127.0.0.1:8000 or LAN 192.168.x.x:8000)
        |
        v
Bridge -> { text, language, provider, model, latencyMs }
        |
        v
Composer -> fill draft -> user sends -> session.prompt -> DSH
```

The mobile client never calls FunASR directly and never sees STT credentials.

## 5. Bridge API

### `POST /api/transcribe`

Request:

```http
Authorization: Bearer <BRIDGE_SECRET>
Content-Type: audio/webm;codecs=opus
X-Audio-Duration-Ms: 8420
X-Audio-Language: zh
```

Body: raw audio bytes, maximum 8 MB.

Response:

```json
{
  "text": "把支付回调改成异步处理",
  "language": "zh",
  "provider": "funasr",
  "model": "SenseVoiceSmall",
  "durationMs": 8420,
  "latencyMs": 620
}
```

Rules:

- Accept `audio/webm`, `audio/mp4`, `audio/wav`, `audio/ogg`.
- Reject unsupported MIME with 415.
- Reject oversized bodies with 413.
- Reject missing/invalid auth with 401.
- Enforce 60 s maximum; use `ffprobe` when available and never trust only the client header.
- Limit concurrent transcriptions (`STT_CONCURRENCY`, default 1) and return 429 when saturated.
- Timeout with 504.
- Return 503 when STT is disabled.
- Never log audio bytes, transcript text, full STT URLs, or keys. Log bytes, duration, latency, provider, and error code only.

### Health

Extend `/health`:

```json
{
  "ok": true,
  "stt": {
    "enabled": true,
    "provider": "funasr",
    "model": "SenseVoiceSmall",
    "reachable": true
  }
}
```

`reachable` is a cached probe; STT downtime must not fail the Bridge health check.

### STT adapter

```ts
interface SpeechToText {
  transcribe(input: {
    data: Uint8Array
    mimeType: string
    language?: string
    durationMs?: number
  }): Promise<{
    text: string
    language?: string
    provider: string
    model: string
  }>
}
```

Implement `OpenAICompatibleStt` with Node's built-in `fetch`, `FormData`, and `Blob`. It calls `${STT_BASE_URL}/audio/transcriptions` with `file`, `model`, `language`, and `response_format=json`.

## 6. Bridge configuration

```env
STT_ENABLED=true
STT_PROVIDER=funasr
STT_BASE_URL=http://127.0.0.1:8000/v1
# STT_BASE_URL=http://192.168.1.50:8000/v1
STT_MODEL=SenseVoiceSmall
STT_LANGUAGE=zh
STT_TIMEOUT_MS=60000
STT_MAX_BYTES=8388608
STT_MAX_DURATION_MS=60000
STT_CONCURRENCY=1
# STT_API_KEY_ENV=STT_API_KEY
```

All deployment differences are environment configuration; no code changes are required to switch from local Docker to a LAN GPU machine.

## 7. Mobile UX

### Recording states

```ts
type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error'
```

### Interaction

- Press and hold the microphone button.
- `pointerdown` starts recording; `pointerup`/`pointercancel` stops and uploads.
- `contextmenu` is prevented; `touch-action: none`; pointer capture is used.
- 60 s auto-stop; clips under 300 ms are treated as accidental.
- Recording bar shows timer, input level, cancel, and stop.
- While transcribing, show a spinner and disable a second recording.
- On success, append the transcript to the draft and focus the textarea.
- Do not auto-send.
- Keyboard fallback: click or Space/Enter toggles recording.

### Browser recording

- `getUserMedia` with mono, echo cancellation, noise suppression, AGC.
- Choose the first supported MediaRecorder MIME:
  1. `audio/webm;codecs=opus`
  2. `audio/mp4;codecs=mp4a.40.2`
  3. `audio/mp4`
- Release all MediaStream tracks and AudioContext resources on stop/unmount.
- Stop on page hide or navigation.
- Keep the Blob in memory only; drop it after transcription.

### Errors

Handle and localize:

- insecure context (`!window.isSecureContext`)
- permission denied
- unsupported browser
- too short / empty transcript
- STT timeout or network error with retry
- not the writer / session running (mic disabled)

### Demo mode

Disable recording or use a local fake transcript; never call a real STT service from demo mode.

## 8. FunASR deployment

Add `deploy/stt/docker-compose.yml`:

- FunASR runtime, port 8000.
- CPU default; optional GPU profile.
- Persistent model cache volume.
- Healthcheck against the actual FunASR health route.
- OpenAI-compatible endpoint exposed at `/v1`.
- Pin the image/tag after verifying it in this environment.

Same host:

```env
STT_BASE_URL=http://127.0.0.1:8000/v1
```

LAN GPU machine:

```env
STT_BASE_URL=http://192.168.1.50:8000/v1
```

The Bridge must be able to reach the STT port; no CORS is involved because the Bridge is the HTTP client.

Preferred model: SenseVoiceSmall. If it cannot decode webm/mp4 directly, transcode to 16 kHz mono WAV inside the STT container with ffmpeg. Add attribution for FunASR model weights in the README/deploy notes.

## 9. Testing

### Bridge

- 401 without/with invalid token.
- 200 with a fake STT adapter and a short WAV fixture.
- 413 oversized, 415 unsupported MIME, 503 disabled, 504 timeout, 429 concurrency.
- `/health` includes STT state.
- Config tests for local and LAN base URLs.
- Adapter test for OpenAI-compatible request/response mapping.

### Mobile

- Playwright Chromium fake microphone.
- Mock `/api/transcribe` to return Chinese text.
- Press-and-hold starts/stops recording; draft is filled; no auto-send.
- Cancel, permission denied, empty transcript, and retry states.
- 390×844 and 320×700; Light/Dark; no horizontal overflow.

### Real device

- iPhone Safari with local HTTPS and fully trusted cert.
- Android Chrome with local HTTPS.
- Confirm `window.isSecureContext`, MIME type, 60 s cap, and transcript fill.
- Run a real FunASR smoke test; do not commit user audio.

## 10. Implementation phases

1. Bridge: config, STT adapter, `/api/transcribe`, health, tests.
2. Mobile: recorder hook, press-and-hold composer UI, draft fill, Playwright.
3. Deployment/dev: FunASR compose, mkcert/Vite HTTPS, smoke script, docs/notes.

Each phase gets unit tests, focused verification, a design-note update, and a Conventional Commit.
