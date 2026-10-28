# FunASR STT deployment assets, CPU torch, and mirror defaults

- Date: 2026-10-28
- Scope: `deploy/stt/**`, `scripts/smoke-stt.ts`
- Status: assets `13d92a1`; torch fix `b310199`; mirror defaults here; build still unverified

## Context

FunASR has no official OpenAI-compatible image. Oracle #3 found the image
installed FunASR without CPU torch/torchaudio, so `server.py` would fail at
import before uvicorn bound :8000 and the container would never become healthy.
A later build also failed at Docker Hub token auth (`auth.docker.io`, likely
IPv6/proxy), so build inputs need domestic/offline paths.

## Decision

- Check out FunASR at `d91d961e37a005837b1523bcc6b09f087877be54`; the repo URL is
  `FUNASR_REPO` (GitHub default, Gitee mirror documented).
- Default the base to the locally cached `python:3.12-slim` (linux/amd64) so the
  build does not pull from Docker Hub. This differs from the upstream example's
  3.10; torch 2.6.0 cp312 wheels exist and FunASR declares `python>=3.7`, but the
  3.12 combination is unbuilt. `PYTHON_IMAGE` overrides to 3.10 or a mirror.
- Install pinned CPU `torch==2.6.0` / `torchaudio==2.6.0` from `TORCH_INDEX_URL`
  before `pip install -e .`. This is mandatory: FunASR imports `torch` at model
  load, so without it the process exits before uvicorn. All pip installs use
  `PIP_INDEX_URL`.
- Default `FUNASR_MODEL=paraformer` in the Dockerfile, Compose, and Bridge.
- Publish `127.0.0.1:8000`; the example server has no auth. LAN exposure is an
  explicit `FUNASR_HOST_PORT=0.0.0.0:8000` opt-in.
- Healthcheck `GET /health` with a 900 s `start_period` for cold model downloads.
  A `/v1/models` 200 proves the server/pre-loaded alias is up, not per-model
  readiness; only a transcription proves a requested alias works.
- Bind `./models` to `/root/.cache` for persistent ModelScope/HF downloads.
- FunASR is MIT; model weights carry their own ModelScope/HF licences. CPU image;
  GPU needs CUDA torch wheels and the NVIDIA toolkit.

## Availability probes (short, no build)

- `docker images`: `python:3.12-slim` present, linux/amd64. `docker manifest
  inspect` timed out for Docker Hub and mirror tags (including the local tag,
  because it probes the registry), so the local image is the safe default.
- PyPI indexes: Tsinghua 200 (~0.2 s), Aliyun 200, pypi.org 200.
- torch CPU indexes: official and SJTU 200 and both list `2.6.0` cp312; the
  Aliyun torch mirror returned 200 but no `2.6.0` cp312 wheel.
- `git ls-remote`: GitHub and `gitee.com/mirrors/FunASR.git` both OK (469 refs);
  the Gitee API confirms the pinned commit. `gitcode.com` had no refs.

## Verification

- `docker compose -f deploy/stt/docker-compose.yml config` — passed.
- `pnpm exec biome check deploy/stt scripts/smoke-stt.ts` — passed.
- Not verified: image build, container start, `/v1/models`, real WAV/webm/m4a
  inference, GPU, or that the 3.12 base builds with FunASR. The mirror defaults
  and torch fix remain unproven at runtime.

## Follow-ups

- Run a real `docker compose build` + `up` with the chosen mirrors, then
  `/v1/models` and one WAV, one webm, and one m4a transcription through the Bridge.
- Pin the base image digest and model weight revisions; publish a private image.
