# FunASR STT deployment assets and CPU torch boundary

- Date: 2026-10-28
- Scope: `deploy/stt/**`, `scripts/smoke-stt.ts`
- Status: assets landed in `13d92a1`; Oracle #3 torch blocker fixed on paper, runtime unverified

## Context

The Bridge needs a local OpenAI-compatible STT service. FunASR has an example
server at `examples/openai_api`, but no official image and no reproducible
Dockerfile: upstream installs unpinned PyPI `funasr` and copies only `server.py`.
Oracle #3 found FunASR was installed without CPU torch/torchaudio, so `server.py`
would fail at import before uvicorn bound :8000 and never become healthy.

## Options considered

1. Use upstream as-is. Rejected: unpinned source and no explicit CPU torch.
2. Build from PyPI without pinning. Rejected: aliases/server contract drift.
3. Pin the source and install CPU torch first (chosen).

## Decision

- Check out FunASR at `d91d961e37a005837b1523bcc6b09f087877be54` in the image and
  install it editable from that checkout.
- Install pinned CPU `torch==2.6.0` / `torchaudio==2.6.0` from
  `https://download.pytorch.org/whl/cpu` **before** `pip install -e .`. `2.6.0`
  cp310 CPU wheels were confirmed on the PyTorch index. `ARG TORCH_VERSION`
  documents the pin; bump torch and torchaudio together. Without this step
  FunASR's import fails and the healthcheck never passes.
- Default `FUNASR_MODEL=paraformer` in the Dockerfile, Compose, and Bridge so a
  bare `docker run` matches the app. `sensevoice` stays as the faster alternative.
- Publish `127.0.0.1:8000` by default. The example server has no auth; LAN
  exposure is an explicit `FUNASR_HOST_PORT=0.0.0.0:8000` opt-in.
- Healthcheck `GET /health` with a 900 s `start_period`, because the first start
  downloads model weights before uvicorn listens. `/v1/models` 200 proves the
  server and pre-loaded alias are up, not per-model readiness; only a real
  transcription proves a requested alias works.
- Bind `./models` to `/root/.cache` so ModelScope/Hugging Face downloads survive
  rebuilds; it is git-ignored.
- Document licences: FunASR is MIT; model weights carry their own ModelScope/HF
  licences. CPU image; GPU needs CUDA torch wheels + NVIDIA toolkit (not provided).

## Verification

- `docker compose -f deploy/stt/docker-compose.yml config` — passed.
- `pnpm exec tsx scripts/smoke-stt.ts --help` — passed.
- `pnpm exec biome check deploy/stt scripts/smoke-stt.ts` — passed (README/YAML
  checked; Dockerfile is not a Biome file type). The wider `scripts` check fails
  on another lane's unformatted `scripts/check-certs.mjs`, outside this scope.
- Lightweight `tsc --noEmit` on the smoke script — passed.
- Fake Bridge round trip with a temp WAV — verified headers, auth, body size, and
  JSON output; **not** FunASR.
- Not verified: image build, container start, `/v1/models`, real WAV/webm/m4a
  inference, GPU. The torch fix is therefore unproven at runtime.

## Follow-ups

- Run a real `docker compose build` + `up`, then `/v1/models` and one WAV, one
  webm, and one m4a transcription through the Bridge.
- Pin the base image digest and model weight revisions; publish a private image.
