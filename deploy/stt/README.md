# FunASR STT deployment (OpenAI-compatible)

Self-hosted speech-to-text for the DSH Mobile Bridge. This directory builds the
upstream FunASR [OpenAI-compatible example server][upstream] from a pinned
commit and publishes it at `POST /v1/audio/transcriptions`, so the Bridge only
needs `STT_BASE_URL` and `STT_MODEL`.

- Upstream source: `modelscope/FunASR`, `examples/openai_api`
- Pinned commit: `d91d961e37a005837b1523bcc6b09f087877be54`
- Image: `funasr-openai-api:cpu-2026-10`
- Default alias: `paraformer` (Chinese, punctuation enabled)
- Alternative alias: `sensevoice` (faster, multilingual, no separate punctuation model)

> The upstream example server has **no authentication and no upload limit**. It
> is a local/LAN development service. Keep the published port on loopback unless
> the network is trusted, and always keep the Bridge as the only client that
> phones can reach.

## Quick start (CPU, same host)

Prerequisites: Docker Engine/Desktop with Compose v2. No image is published;
the first `docker compose up --build` installs the pinned CPU torch layer and
downloads model weights (hundreds of MB), so allow several minutes.

```bash
cd deploy/stt
mkdir -p models
docker compose up -d --build
docker compose logs -f stt
```

Verify readiness:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/v1/models
```

Transcribe a local WAV (any short clip; no audio is committed to this repo):

```bash
curl http://127.0.0.1:8000/v1/audio/transcriptions \
  -F file=@sample.wav \
  -F model=paraformer \
  -F response_format=json
```

Then point the Bridge at it (see [Bridge configuration](#bridge-configuration)).

Stop / rebuild:

```bash
docker compose down
docker compose build --no-cache stt   # after changing the pinned commit
```

### Build inputs and domestic mirrors

All build inputs are Compose build args with defaults in `docker-compose.yml`.
Override them in `deploy/stt/.env` (see `.env.example`) or on the command line:

| Arg               | Default (this host)                         | Domestic / fallback                                                       |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `PYTHON_IMAGE`    | `python:3.12-slim` (already cached locally) | `docker.m.daocloud.io/library/python:3.12-slim` (or `docker.1ms.run/...`) |
| `PIP_INDEX_URL`   | `https://pypi.tuna.tsinghua.edu.cn/simple`  | `https://pypi.org/simple`, `https://mirrors.aliyun.com/pypi/simple/`      |
| `TORCH_INDEX_URL` | `https://download.pytorch.org/whl/cpu`      | `https://mirror.sjtu.edu.cn/pytorch-wheels/cpu`                           |
| `TORCH_VERSION`   | `2.6.0`                                     | keep torch/torchaudio identical                                           |
| `FUNASR_REPO`     | `https://github.com/modelscope/FunASR.git`  | `https://gitee.com/mirrors/FunASR.git`                                    |
| `FUNASR_COMMIT`   | `d91d961e...`                               | keep the reviewed commit                                                  |

The defaults were chosen after short reachability probes, not a build: the local
`python:3.12-slim` image is present (linux/amd64), the Tsinghua PyPI index
returned 200, the official and SJTU torch indexes returned 200 and both list the
`2.6.0` cp312 CPU wheels, and `git ls-remote` succeeded for GitHub and Gitee
(the pinned commit exists on the Gitee mirror). Docker Hub mirror manifests timed
out from this host, which is why the base image defaults to the local tag.

Example override for a machine without the local base image:

```bash
cd deploy/stt
PYTHON_IMAGE=docker.m.daocloud.io/library/python:3.12-slim \
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
docker compose build
```

`PYTHON_IMAGE` is the only image pulled from a registry; the PyPI/torch/repo
URLs only affect downloads inside the build. The base is 3.12 because that is
what is cached locally; the upstream example originally used 3.10. FunASR
declares `python>=3.7` and torch 2.6.0 cp312 wheels exist, but the 3.12
combination has not been built here. If a dependency rejects 3.12, set
`PYTHON_IMAGE=python:3.10-slim-bookworm` and pull it through a working mirror.

### Docker Hub token auth / IPv6 failures

A build that fails with `failed to fetch oauth token ... auth.docker.io` cannot
reach Docker Hub (expired login, proxy, or broken IPv6). Workarounds, in order:

1. Use the locally cached base image: `docker images python:3.12-slim`. The
   Compose default already matches it, so `FROM` should not hit the network.
2. Pull through a mirror and re-tag:
   `docker pull docker.m.daocloud.io/library/python:3.12-slim` then
   `docker tag docker.m.daocloud.io/library/python:3.12-slim python:3.12-slim`.
3. `docker login docker.io` with a valid account/token.
4. In Docker Desktop, disable IPv6 (Settings → Docker Engine: `"ipv6": false`)
   or remove the broken DNS/proxy entry, then restart Docker.
5. `docker manifest inspect` is only a probe and still uses the registry; a
   timeout there does not mean the local image is broken.

### End-to-end through the Bridge

With the Bridge running and `BRIDGE_SECRET` set:

```bash
BRIDGE_SECRET=... pnpm exec tsx scripts/smoke-stt.ts --file sample.wav --duration-ms 3200
```

The script posts raw audio to `POST /api/transcribe`; it never prints the audio
or the token. See `scripts/smoke-stt.ts --help`.

## Models

Aliases are defined by the pinned `examples/openai_api/server.py`. Use the same
alias in the Bridge's `STT_MODEL`.

| Alias                     | Checkpoint                                              | Notes                                                                                                                   |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `paraformer`              | `paraformer-zh` + FSMN-VAD + CT-Transformer punctuation | Default. Chinese (and Chinese/English mix), punctuation restored. Best for Chinese dictation.                           |
| `sensevoice`              | `iic/SenseVoiceSmall` + FSMN-VAD                        | Faster. Multilingual (zh/yue/en/ja/ko). No separate punctuation component; special model tags are stripped from output. |
| `paraformer-en`           | `paraformer-en` + FSMN-VAD                              | English-only alias; no punctuation component.                                                                           |
| `fun-asr-nano`            | `FunAudioLLM/Fun-ASR-Nano-2512`                         | Larger, Hugging Face hub, trust-remote-code. Not the v1 default.                                                        |
| `moss-transcribe-diarize` | OpenMOSS MOSS-Transcribe-Diarize                        | Diarization adapter with its own model licence and dependencies; not the v1 default.                                    |

`FUNASR_MODEL` in `docker-compose.yml` is pre-loaded at container startup. A
request for a different alias loads it lazily (and downloads it if missing), so
the first request for a new alias is slow. `paraformer` is pre-loaded by default
to match the Bridge default.

## Model cache

`./models` is bind-mounted to `/root/.cache` in the container, so ModelScope
(`modelscope`) and Hugging Face (`huggingface`) downloads survive rebuilds. The
directory is git-ignored.

- On Linux the container may create `models/` owned by `root`; `sudo chown -R
  "$USER" models` if needed.
- Deleting `models/` forces a re-download on the next start.
- On Windows the bind mount goes through Docker Desktop; it works, just slower
  than a named volume on large caches.

## Health and readiness

| Endpoint         | Meaning                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`    | Process is listening. Returns `device`, `models_loaded`, `models_available`.                                                                                                        |
| `GET /v1/models` | Server is up and returns aliases with a per-model `ready` flag. Confirms the server and pre-loaded alias are up; it does not prove a different requested alias is loaded or usable. |

The server pre-loads `FUNASR_MODEL` **before** starting uvicorn, so `/health`
does not answer until the initial model is ready. The Compose healthcheck uses
`/health` with a 15-minute `start_period` to absorb a cold download. A 200 from
`/v1/models` is a server/pre-loaded-alias liveness signal, not per-model
readiness; only a real transcription request proves the requested alias works.

## Network layout and LAN GPU

Default: `127.0.0.1:8000` on the Docker host. The Bridge on the same host uses:

```env
STT_BASE_URL=http://127.0.0.1:8000/v1
```

LAN machine (GPU box or another host) uses the machine's LAN address:

```env
STT_BASE_URL=http://192.168.1.50:8000/v1
```

To publish on the LAN, start Compose with an explicit bind:

```bash
FUNASR_HOST_PORT=0.0.0.0:8000 docker compose up -d
```

(or set `FUNASR_HOST_PORT=0.0.0.0:8000` in `deploy/stt/.env`). Only do this on a
trusted LAN, and open the host firewall for TCP 8000.

### GPU host

The shipped Dockerfile is CPU-only. For NVIDIA:

1. Install the NVIDIA driver and NVIDIA Container Toolkit on the host.
2. Build a CUDA-capable image (CUDA PyTorch/torchaudio wheels, e.g. a
   `nvidia/cuda` or `pytorch/pytorch:*-cuda*` base instead of the slim Python
   base). The Dockerfile pins **CPU** torch/torchaudio, so replace that install
   step with matching CUDA wheels; `funasr` must see the GPU inside the
   container.
3. Set `FUNASR_DEVICE=cuda` in `docker-compose.yml`.
4. Uncomment the `deploy.resources.reservations.devices` block at the bottom of
   `docker-compose.yml` and run `docker compose up -d`.

The Bridge configuration is identical; only `STT_BASE_URL` changes.

### Windows Docker Desktop

- With WSL2 backend, `http://127.0.0.1:8000` works from the Windows host and the
  Node Bridge running on Windows.
- From a phone, use the Windows host's LAN IPv4 (`ipconfig`), not
  `localhost`/`host.docker.internal`; Docker Desktop must be running and the
  firewall profile must allow the connection (Private network).
- In PowerShell use `curl.exe` (not the `curl` alias) for the examples above.
- Ensure the `models/` bind mount is on a drive shared with Docker Desktop.

## Audio formats and ffmpeg

The image installs `ffmpeg` and `libsndfile1`. The server writes each upload to
a temp file using the multipart filename extension, then hands it to FunASR, so
the filename suffix matters. The Bridge already sends
`audio.<webm|mp4|wav|ogg|m4a|aac>` from the request MIME type.

- Chrome/Android `MediaRecorder`: `audio/webm;codecs=opus`
- Safari/iOS `MediaRecorder`: `audio/mp4` (AAC)
- WAV, MP3, FLAC, OGG and M4A are also accepted by the example server.

If a browser/container combination fails to decode, normalise before sending or
through a small proxy:

```bash
ffmpeg -i input.webm -ar 16000 -ac 1 -c:a pcm_s16le output.wav
```

FunASR prefers 16 kHz mono; stereo or high-rate inputs work but are slower.

## Bridge configuration

Add to the Bridge `.env` (values shown for the same-host CPU deployment):

```env
STT_ENABLED=true
STT_PROVIDER=funasr
STT_BASE_URL=http://127.0.0.1:8000/v1
STT_MODEL=paraformer
STT_LANGUAGE=zh
```

LAN GPU host:

```env
STT_BASE_URL=http://192.168.1.50:8000/v1
STT_MODEL=paraformer
```

`STT_MODEL` must be one of the aliases above and should match `FUNASR_MODEL`
unless you accept a lazy first-request load. Phones never call FunASR directly;
they reach the Bridge through the Vite HTTPS proxy, and the Bridge makes the
server-to-server request. Re-check `/health` (or the Bridge's `stt.reachable`)
after the container reports healthy.

## Licensing and attribution

- FunASR software is MIT-licensed: <https://github.com/modelscope/FunASR>.
- Model weights (Paraformer, SenseVoiceSmall, FSMN-VAD, CT-Transformer,
  Fun-ASR-Nano, MOSS) are distributed separately on ModelScope/Hugging Face and
  carry their own licences. The repository's MIT licence does not cover them;
  review the checkpoint licence before redistribution or commercial use.
- This deployment is an unmodified build of the upstream example server plus a
  pinned source checkout. Cite FunASR / ModelScope in derivative documentation.

## Reproducibility and known limits

Pinned: the FunASR source commit, the Python base image tag (`python:3.12-slim`,
not a digest), and CPU torch/torchaudio (`ARG TORCH_VERSION`, default `2.6.0`).
The source and package indexes are configurable (see "Build inputs"). Not pinned:

- the rest of the Python dependencies (`funasr` transitive deps,
  fastapi/uvicorn/python-multipart) resolved from `PIP_INDEX_URL` at build time
- the base image digest (follow-up: pin
  `python:3.12-slim@sha256:...`; mirrors may serve a different digest)
- model weight revisions (follow-up: vendor or pin them in the cache)
- the upstream example server's API surface; `/v1/models` and the alias set can
  change between commits

CPU torch/torchaudio are mandatory, not optional: FunASR imports `torch` while
loading the model, so without them `server.py` raises before uvicorn binds :8000,
the container exits, and the healthcheck never passes. The `2.6.0` cp312 CPU
wheels were confirmed on the official and SJTU indexes, but this repository has
not built the image yet.

The upstream Dockerfile is not fully reproducible (it installs unpinned `funasr`
and copies only `server.py`). This Dockerfile improves on that by checking out
the reviewed commit and pinning torch, but it is still not a bit-for-bit
reproducible build. A real `docker compose build` + `up`, a `/v1/models` check,
and at least one transcription are still required before calling the deployment
verified; `docker compose config` and mirror reachability probes only validate
syntax/networking. Build it once, tag/push it privately, and pin that image for
production.

To try a different torch release, build with
`--build-arg TORCH_VERSION=<version>` (torchaudio must have the same version).

[upstream]: https://github.com/modelscope/FunASR/tree/d91d961e37a005837b1523bcc6b09f087877be54/examples/openai_api
