# FunASR OpenAI-compatible API server, CPU-first.
#
# Upstream example:
#   https://github.com/modelscope/FunASR/tree/d91d961e37a005837b1523bcc6b09f087877be54/examples/openai_api
#
# The upstream Dockerfile installs unpinned PyPI packages and copies only
# server.py. This image pins the FunASR source checkout to the reviewed commit
# instead, so the API server code and the model aliases cannot drift silently.
# Python dependencies and model weights are still resolved from PyPI/ModelScope
# at build/run time; see README "Reproducibility".

# A slim Debian base keeps the CPU image small. The default tag is the locally
# cached `python:3.12-slim` (linux/amd64) to avoid another Docker Hub pull: on
# this host Docker Hub token auth/IPv6 has failed. On another machine Docker
# will pull this tag from Docker Hub; override PYTHON_IMAGE with a working
# mirror if that fails. 3.12 vs the original 3.10 is a documented tradeoff; the
# pinned torch 2.6.0 CPU wheels exist for cp312. Pin a digest as a follow-up.
ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}

ARG FUNASR_COMMIT=d91d961e37a005837b1523bcc6b09f087877be54
# GitHub is reachable here; the Gitee mirror is a documented override.
ARG FUNASR_REPO=https://github.com/modelscope/FunASR.git
# Tsinghua is fast/reachable here. Use https://pypi.org/simple to bypass it.
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
# Official CPU wheels work. Domestic alternative that also has 2.6.0 cp312:
# https://mirror.sjtu.edu.cn/pytorch-wheels/cpu
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
# CPU-only torch/torchaudio wheels, pinned to a version available for
# python:3.12 (cp312). Bump both together; torchaudio must match torch.
ARG TORCH_VERSION=2.6.0
# Debian apt mirrors. The default deb.debian.org failed to serve large packages
# (libavcodec61/libflite1/libllvm19) from this host, so default to Tsinghua.
# Alternatives: https://mirrors.aliyun.com/debian(-security),
# https://mirrors.ustc.edu.cn/debian(-security).
ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FUNASR_MODEL=paraformer \
    FUNASR_DEVICE=cpu \
    FUNASR_PORT=8000 \
    MODELSCOPE_CACHE=/root/.cache/modelscope \
    HF_HOME=/root/.cache/huggingface

# ffmpeg/libsndfile1 cover the audio formats browsers produce (webm/opus,
# mp4/AAC) and the wav decoding FunASR relies on. Rewrite the deb822 sources
# file (and legacy sources.list if present) before updating; both
# deb.debian.org/debian-security and security.debian.org forms are handled.
RUN set -eu; \
    rewritten=0; \
    for file in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do \
        if [ -f "$file" ]; then \
            sed -i \
                -e "s|https\?://deb\.debian\.org/debian-security|${APT_SECURITY_MIRROR}|g" \
                -e "s|https\?://security\.debian\.org/debian-security|${APT_SECURITY_MIRROR}|g" \
                -e "s|https\?://security\.debian\.org|${APT_SECURITY_MIRROR}|g" \
                -e "s|https\?://deb\.debian\.org/debian|${APT_MIRROR}|g" \
                "$file"; \
            rewritten=1; \
        fi; \
    done; \
    if [ "$rewritten" = 0 ]; then \
        echo "WARNING: no Debian apt sources file found; using image defaults" >&2; \
    fi; \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        git \
        libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Blobless clone keeps the checkout small while still allowing a detached
# checkout of the reviewed commit. Git's lazy blob fetch happens on checkout.
# Servers without partial-clone support fall back to a full clone.
RUN git clone --filter=blob:none --no-checkout \
        "${FUNASR_REPO}" /opt/FunASR \
    && git -C /opt/FunASR checkout --detach "${FUNASR_COMMIT}" \
    && test "$(git -C /opt/FunASR rev-parse HEAD)" = "${FUNASR_COMMIT}"

# CPU torch/torchaudio must be installed before FunASR. Without them,
# `import funasr` fails in server.py and the container exits before uvicorn
# ever binds :8000 (the healthcheck then fails forever). Installing from the
# PyTorch CPU index avoids pulling the much larger CUDA wheels from PyPI.
WORKDIR /opt/FunASR
RUN python -m pip install --index-url "${PIP_INDEX_URL}" --upgrade pip \
    && python -m pip install --index-url "${TORCH_INDEX_URL}" \
        "torch==${TORCH_VERSION}" \
        "torchaudio==${TORCH_VERSION}" \
    && python -m pip install --index-url "${PIP_INDEX_URL}" -e . \
    && python -m pip install --index-url "${PIP_INDEX_URL}" \
        fastapi \
        "uvicorn[standard]" \
        python-multipart

WORKDIR /opt/FunASR/examples/openai_api

EXPOSE 8000

# /health answers once the server is listening. The server only starts listening
# after the startup model pre-load, so a cold model download is covered by the
# long start_period in docker-compose.yml. /v1/models shows the server and
# pre-loaded alias are up, not per-model readiness; see README
# "Health and readiness".
HEALTHCHECK --interval=30s --timeout=5s --start-period=900s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.getenv('FUNASR_PORT', '8000'), timeout=3).read()" || exit 1

# The server has no authentication of its own. Keep the published port on
# loopback (compose default) unless the network is trusted.
CMD ["sh", "-c", "python server.py --host 0.0.0.0 --port ${FUNASR_PORT:-8000} --device ${FUNASR_DEVICE:-cpu} --model ${FUNASR_MODEL:-paraformer}"]
