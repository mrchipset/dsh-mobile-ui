# Mobile static build + Caddy TLS/reverse proxy.
# Build context is the repository root (see deploy/docker-compose.yml).

ARG NODE_IMAGE=node:22-bookworm-slim
# Global ARG so the second FROM can use it.
ARG CADDY_IMAGE=caddy:2-alpine

FROM ${NODE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PNPM_VERSION=10.25.0

RUN npm install -g "pnpm@${PNPM_VERSION}" --registry="${NPM_REGISTRY}" \
    && pnpm config set registry "${NPM_REGISTRY}"

WORKDIR /src

# Manifests first for layer caching. apps/bridge is included only to keep the
# workspace and frozen lockfile complete.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY apps/mobile/package.json apps/mobile/
COPY apps/bridge/package.json apps/bridge/
RUN pnpm install --frozen-lockfile --filter @dsh-mobile/mobile... \
        --registry="${NPM_REGISTRY}"

COPY packages/protocol ./packages/protocol
COPY apps/mobile ./apps/mobile

RUN pnpm --filter @dsh-mobile/mobile build

FROM ${CADDY_IMAGE}

COPY --from=build /src/apps/mobile/dist /srv
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile

EXPOSE 443
