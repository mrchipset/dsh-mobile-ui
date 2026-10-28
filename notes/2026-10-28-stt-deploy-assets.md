# FunASR STT deployment assets, CPU torch, and mirror defaults

- Date: 2026-10-28
- Scope: `deploy/stt/**`, `scripts/smoke-stt.ts`
- Status: assets `13d92a1`; torch fix `b310199`; apt mirror added; build still unverified

## Context

FunASR has no official OpenAI-compatible image. Oracle #3 found the image
installed FunASR without CPU torch/torchaudio, so `server.py` would fail at import
before uvicorn bound :8000. A later build failed at Docker Hub token auth, then
at the Debian apt layer after ~40 min (`libavcodec61`, `libflite1`, `libllvm19`
fetch failures), so build inputs need domestic/offline paths.

## Decision

- Check out FunASR at `d91d961e37a005837b1523bcc6b09f087877be54`; `FUNASR_REPO`
  defaults to GitHub, with the Gitee mirror documented.
- Default the base to the locally cached `python:3.12-slim` (linux/amd64, Debian
  13 trixie) to avoid Docker Hub. 3.12 vs upstream 3.10 is documented;
  `PYTHON_IMAGE` overrides. torch 2.6.0 cp312 exists, but 3.12 is unbuilt.
- Install pinned CPU `torch==2.6.0` / `torchaudio==2.6.0` from `TORCH_INDEX_URL`
  before `pip install -e .` (mandatory: FunASR imports torch at load; otherwise
  the process exits before uvicorn). All pip installs use `PIP_INDEX_URL`.
- Rewrite apt sources (deb822 and legacy list) to `APT_MIRROR` /
  `APT_SECURITY_MIRROR` before update, with `Acquire::Retries=5`. Defaults are
  Tsinghua; Aliyun/USTC are documented. A missing sources file warns, not fails.
- Default `FUNASR_MODEL=paraformer`; publish `127.0.0.1:8000` (no server auth).
- Healthcheck `/health` with a 900 s `start_period`; `/v1/models` 200 means the
  server and pre-loaded alias are up, not per-model readiness.
- Bind `./models` to `/root/.cache` for persistent ModelScope/HF downloads.
- FunASR is MIT; weights carry their own licences. CPU image; GPU needs CUDA
  torch wheels and the NVIDIA toolkit.

## Availability probes (short, no build)

- `docker images`: `python:3.12-slim` present, linux/amd64; os-release is Debian
  13 trixie. Docker Hub/mirror manifest probes timed out, so local is default.
- PyPI: Tsinghua 200 (~0.2 s), Aliyun 200, pypi.org 200.
- Debian apt: Tsinghua and Debian-security `dists/trixie*/Release` 200 (~190 ms);
  Aliyun 200; USTC 200.
- torch: official and SJTU 200 with `2.6.0` cp312; Aliyun 200 but no 2.6.0 cp312.
- `git ls-remote`: GitHub and `gitee.com/mirrors/FunASR.git` OK; the Gitee API
  has the pinned commit. `gitcode.com` had no refs.

## Verification

- `docker compose -f deploy/stt/docker-compose.yml config` — passed.
- `pnpm exec biome check deploy/stt scripts/smoke-stt.ts` — passed.
- Not verified: image build, container start, `/v1/models`, real WAV/webm/m4a
  inference, GPU, or 3.12+FunASR. The apt/torch/mirror fixes remain unproven.

## Follow-ups

- Retry `docker compose -f deploy/stt/docker-compose.yml up -d --build`, then
  `/v1/models` and one WAV, webm, and m4a through the Bridge.
- Pin the base image digest and model weight revisions; publish a private image.
