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
- UX: touch press-and-hold to record, release to transcribe; mouse click and Space/Enter toggle; fill the input box.
- Devices: Android and iPhone.
- Network: LAN access from phones.
- Recording limit: 60 seconds.
- Model: `paraformer` default (Chinese + punctuation); model configurable. `sensevoice` is a faster alternative.
- Security: existing Bearer token remains; no new auth hardening in v1.

## 3. Critical browser constraint: secure context

`getUserMedia` and `MediaRecorder` are only available in a secure context:

- `https://...` works.
- `http://localhost` works.
- `http://192.168.x.x` does not expose `navigator.mediaDevices`.

Ignoring production security does not remove this browser requirement. For Android + iPhone, use local HTTPS:

Stop any existing HTTP dev server on port `5174` first. From the repo root:

bash:
```bash
mkdir -p .certs
mkcert -install
mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem 192.168.71.5 localhost 127.0.0.1
pnpm dev:mobile:https
```

PowerShell:
```powershell
New-Item -ItemType Directory -Force .certs
mkcert -install
mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem 192.168.71.5 localhost 127.0.0.1
pnpm dev:mobile:https
```

Replace `192.168.71.5` if the LAN IP changes. `mkcert` is preferred; if it is unavailable, create an equivalent local CA and leaf certificate with OpenSSL and install that CA on the phone. `pnpm dev:mobile:https` checks for both `.certs/` files and uses Vite `--strictPort` on `https://192.168.71.5:5174`.

Install the mkcert root CA on the phone; iPhone also enables full trust (Settings → General → About → Certificate Trust Settings). Android installs it as a user CA.

The Bridge remains HTTP and is reached only through the Vite proxy, which forwards `/api` to `http://127.0.0.1:8787` and `/ws` to `ws://127.0.0.1:8787`. Plain `http://192.168.71.5:5174` disables real `getUserMedia`; only HTTPS or localhost enables the microphone. `.certs/` is git-ignored. Allow Vite `5174` (and Bridge `8787` if phones connect directly) through the Windows firewall on Private networks.

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
  "model": "paraformer",
  "durationMs": 8420,
  "latencyMs": 620
}
```

Rules:

- Accept `audio/webm`, `audio/mp4`, `audio/wav`, `audio/ogg`, `audio/x-m4a`, and `audio/aac`; clients must send an explicit MIME.
- Authenticate in a route-level `onRequest` hook, so 401 wins before the body is buffered or a 413 is decided.
- Reject unsupported MIME with 415.
- Reject oversized bodies with `413 { error: "audio_too_large", maxBytes }`.
- Reject missing/invalid auth with 401.
- Enforce the duration cap from `X-Audio-Duration-Ms`; server-side `ffprobe` enforcement is a follow-up.
- Limit concurrent transcriptions (`STT_CONCURRENCY`, default 1) and return 429 when saturated.
- Timeout with 504; other upstream failures return 502.
- Return 503 when STT is disabled.
- Never log audio bytes, transcript text, full STT URLs, or keys. Log bytes, duration, latency, provider, error code, and numeric upstream status only.

### Health

Extend `/health`:

```json
{
  "ok": true,
  "stt": {
    "enabled": true,
    "provider": "funasr",
    "model": "paraformer",
    "reachable": true
  }
}
```

`reachable` probes `${STT_BASE_URL}/models` with a ~2 s timeout and a ~30 s cache. STT downtime must not fail or hang the Bridge health check. When `STT_ENABLED=false`, `/health` consistently reports `reachable: false` and does not probe. This is server-side diagnostics only; the mobile client does not consume it yet. `/v1/models` proves the server or a preloaded alias is up, not that a specific model has completed loading.

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

Implement `OpenAICompatibleStt` with Node's built-in `fetch`, `FormData`, and `Blob`. It calls `${STT_BASE_URL}/audio/transcriptions` with `file`, `model`, `language` (omitted when `auto`), and `response_format=json`; an upstream `language` field wins when present.

### Voice attachments

- Upload: `POST /api/sessions/:sessionId/audio` with Bearer auth, a raw audio body, and `X-Audio-Duration-Ms`. It reuses the MIME allowlist and `STT_MAX_BYTES` / `STT_MAX_DURATION_MS` limits.
- Storage keeps the original bytes plus an M4A/AAC playback copy. `FFMPEG_PATH` (default `ffmpeg`) transcodes with `-vn -c:a aac -b:a 64k -movflags +faststart`. If ffmpeg is unavailable, fails, times out, or writes no output, playback falls back to the original bytes and MIME type.
- Upload responds `201` with `{ id, mimeType, playbackMimeType, durationMs, sizeBytes }`.
- Playback: `GET /api/audio/:id` with Bearer auth returns the playback BLOB, `Content-Type: playbackMimeType`, `Content-Length`, and `Cache-Control: private, max-age=86400`. Audio bytes never enter WS messages or snapshots.
- Prompt integration: `session.prompt.audioId` must belong to the same session. The Bridge marks `client_msg_id`, then writes `audio` metadata into the synthetic `user_message_chunk`. Unknown or cross-session IDs reject with `audio_not_found` / `audio_session_mismatch` before ACP.
- `fold` projects persisted `payload.audio` into `MessageBlock.audio`. The `audio_attachments` table stores metadata and both BLOBs, with an index on `(session_id, created_at)` and FK cascade on session delete.
- The v1 limitation is that audio uploaded for a prompt that is never sent remains until a future TTL cleanup.

## 6. Bridge configuration

```env
# Start deploy/stt first, then enable:
STT_ENABLED=true
STT_PROVIDER=funasr
STT_BASE_URL=http://127.0.0.1:8000/v1
# STT_BASE_URL=http://192.168.71.5:8000/v1
STT_MODEL=paraformer
STT_LANGUAGE=zh
STT_TIMEOUT_MS=60000
STT_MAX_BYTES=8388608
STT_MAX_DURATION_MS=60000
STT_CONCURRENCY=1
# STT_API_KEY_ENV=STT_API_KEY
FFMPEG_PATH=ffmpeg
```

All deployment differences are environment configuration; no code changes are required to switch from local Docker to a LAN GPU machine.

## 7. Mobile UX

### Recording states

```ts
type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error'
```

### Interaction

- Touch/pen press-and-hold records; release uploads.
- Mouse click toggles recording; Space/Enter on the focused mic also toggles.
- `pointerdown` starts a hold for touch/pen; `pointerup`/`pointercancel` stops and uploads.
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
STT_BASE_URL=http://192.168.71.5:8000/v1
```

The Bridge must be able to reach the STT port; no CORS is involved because the Bridge is the HTTP client. Readiness is checked through `/v1/models`.

Preferred model: `paraformer` (Chinese + punctuation); `sensevoice` is a faster alternative. If FunASR cannot decode webm/mp4 directly, transcode to 16 kHz mono WAV inside the STT container with ffmpeg. Add attribution for FunASR model weights in the README/deploy notes.

## 9. Testing

### Bridge

- 401 without/with invalid token.
- 200 with a fake STT adapter and a short WAV fixture.
- 413 oversized, 415 unsupported MIME, 503 disabled, 504 timeout, 429 concurrency.
- `/health` includes STT state and cached `/models` reachability.
- Config tests for local and LAN base URLs, and readiness tests for true/false, timeout, cache, and disabled state.
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
