# Bridge + DSH runtime. Bridge and DSH share this container because ACP is stdio.
# Build context is the repository root (see deploy/docker-compose.yml).

# Local image (node 22.23.4) avoids Docker Hub pulls on this host. Override with
# a domestic mirror when building elsewhere: docker.m.daocloud.io/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PNPM_VERSION=10.25.0
# HTTP (not HTTPS) until ca-certificates exists in the image; apt verifies GPG signatures.
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security

# node-gyp must use the headers shipped in the Node image; nodejs.org is not
# reachable here (better-sqlite3 otherwise fails to download prebuilt headers).
ENV npm_config_nodedir=/usr/local

# better-sqlite3 is a native dependency; keep a compiler in the builder.
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
        echo "WARNING: no Debian apt sources file found" >&2; \
    fi; \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
        ca-certificates \
        git \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g "pnpm@${PNPM_VERSION}" --registry="${NPM_REGISTRY}" \
    && pnpm config set registry "${NPM_REGISTRY}"

WORKDIR /src

# Manifests first for layer caching. apps/mobile is copied only so the workspace
# and frozen lockfile stay complete; it is not installed or built here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/bridge/package.json apps/bridge/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @dsh-mobile/bridge... \
        --registry="${NPM_REGISTRY}"

COPY packages/protocol ./packages/protocol
COPY apps/bridge ./apps/bridge

RUN pnpm --filter @dsh-mobile/bridge build \
    && pnpm --filter @dsh-mobile/bridge deploy --prod --legacy /app

FROM ${NODE_IMAGE} AS runtime

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG DSH_VERSION=0.2.1-rc.2
ARG PNPM_VERSION=10.25.0
# HTTP (not HTTPS) until ca-certificates exists in the image; apt verifies GPG signatures.
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security

ENV NODE_ENV=production \
    npm_config_nodedir=/usr/local

# ffmpeg transcode, git/ripgrep for DSH tools. python3/make/g++ cover npm native
# addons during the global DSH install and are purged afterwards.
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
        echo "WARNING: no Debian apt sources file found" >&2; \
    fi; \
    apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        git \
        ripgrep \
        python3 \
        make \
        g++ \
    && npm install -g \
        "pnpm@${PNPM_VERSION}" \
        "@deepseek-ai/dsh@${DSH_VERSION}" \
        --registry="${NPM_REGISTRY}" \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app

COPY --from=build /app /app
# pnpm deploy should include dist, but copy it explicitly so the runtime path is
# deterministic even if deploy trims build output.
COPY --from=build /src/apps/bridge/dist /app/dist
# deploy/dsh/profiles/acp/... -> /opt/dsh-profiles/acp/...
COPY deploy/dsh/profiles /opt/dsh-profiles
COPY deploy/bridge/entrypoint.sh /usr/local/bin/dsh-bridge-entrypoint

RUN sed -i 's/\r$//' /usr/local/bin/dsh-bridge-entrypoint \
    && chmod +x /usr/local/bin/dsh-bridge-entrypoint

EXPOSE 8787

ENTRYPOINT ["/usr/local/bin/dsh-bridge-entrypoint"]
