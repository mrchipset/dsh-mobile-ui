# Voice attachment end-to-end test

- Date: 2026-10-29
- Scope: `apps/bridge/tests`, `doc/voice-input-design.md`
- Status: implemented; browser/device leg deferred

## Context

Voice attachments had unit coverage for upload, prompt linking, folding, and playback,
but no single test followed the whole path with a real HTTP server and WebSocket.
The remaining follow-up was a real Bridge + FunASR + device run.

This sandbox cannot run that run: Node child-process pipes, Chrome Mojo named pipes,
and the DSH ACP stdio pipe are all denied. `pnpm test` also needs `--pool=threads`
because Vitest's default fork pool spawns workers, plus an uncommitted local guard
around Vite's Windows `net use` probe; neither workaround changes repo files.

## Options

1. Playwright against the dev server and real Bridge. Rejected here: the browser
   cannot start or connect over its pipe, and the ACP supervisor cannot spawn DSH.
2. Keep using `app.inject`. Rejected: it skips sockets, headers, and streaming order.
3. Real HTTP/WS harness with fake external boundaries (chosen).

## Decision

- Add `apps/bridge/tests/voice-attachment-e2e.test.ts`.
- Use a real Fastify listener, real `ws` client, real SQLite, and the real
  `OpenAICompatibleStt` adapter pointed at a local fake `/v1` server.
- Fake only ACP (no model turn), ffmpeg (fixed M4A playback bytes), and the STT
  upstream. The mobile `uploadAudio` / `acquireRemoteAudioUrl` modules talk to the
  Bridge so the client wire format is covered.
- Flow: `/api/transcribe` → `uploadAudio` → attach → prompt with `audioId` →
  `session.update` + `session.prompt.done` → authenticated playback (headers and
  bytes) → release/re-fetch → 401 with a bad token → fresh WS attach after
  "reload" → snapshot and `fold` retain the audio → playback again.
- Assert the persisted original/playback BLOBs, MIME types, and `clientMsgId`.

## Tradeoffs / risks

- No React rendering, so chip/player layout and focus behavior still need browser
  coverage.
- Fake ACP, ffmpeg, and STT upstream do not prove a real model turn, real M4A
  transcode, or FunASR accuracy.
- The test uses the mobile audio modules from the Bridge project; `tsc` covers it
  through the Bridge test tsconfig. Global `fetch` is restored in teardown.

## Verification

- `pnpm exec vitest run apps/bridge/tests/voice-attachment-e2e.test.ts --pool=threads` — 1 passed.
- `pnpm exec vitest run --pool=threads` — 20 files / 148 tests passed.
- `pnpm typecheck` — passed.
- `pnpm exec biome check apps/bridge/tests/voice-attachment-e2e.test.ts` — passed.
- Not verified: browser UI, physical phone, real DSH prompt, real FunASR, real ffmpeg.

## Follow-ups

- Run this on a host with Chrome/DSH; add Playwright coverage for the chip/player
  and re-run `pnpm smoke:acp` / `pnpm smoke:stt` with real services.
