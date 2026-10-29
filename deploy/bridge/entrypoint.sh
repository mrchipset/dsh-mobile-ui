#!/bin/sh
# Bridge + DSH container entrypoint.
# Prepares DSH_HOME, seeds the acp profile, installs the LLM patch, then starts
# the Bridge. Bridge and DSH must share a container: ACP is stdio.
set -eu

DSH_HOME="${DSH_HOME:-/data/dsh}"
DSH_PROFILE="${DSH_PROFILE:-acp}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

PROFILE_DIR="$DSH_HOME/profiles/$DSH_PROFILE"
PATCH_SRC="/opt/dsh-profiles/$DSH_PROFILE/cordis.patch.yml"

export DSH_HOME WORKSPACE_ROOT
export NPM_CONFIG_REGISTRY="$NPM_REGISTRY"
export npm_config_registry="$NPM_REGISTRY"

mkdir -p "$DSH_HOME" "$WORKSPACE_ROOT" "$PROFILE_DIR"

write_npmrc() {
    printf 'registry=%s\n' "$NPM_REGISTRY" > "$DSH_HOME/.npmrc"
}

seed_profile() {
    if [ ! -f "$PROFILE_DIR/package.json" ]; then
        cat > "$PROFILE_DIR/package.json" <<'JSON'
{
  "name": "dsh-profile-acp",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-acp-app"
      ]
    }
  }
}
JSON
    fi
    if [ ! -f "$PROFILE_DIR/cordis.yml" ]; then
        printf '[]\n' > "$PROFILE_DIR/cordis.yml"
    fi
    if [ ! -f "$PROFILE_DIR/pnpm-workspace.yaml" ]; then
        printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' \
            > "$PROFILE_DIR/pnpm-workspace.yaml"
    fi
}

copy_patch() {
    if [ -f "$PATCH_SRC" ]; then
        cp "$PATCH_SRC" "$PROFILE_DIR/cordis.patch.yml"
    else
        echo "WARNING: DSH patch not found: $PATCH_SRC" >&2
    fi
}

write_npmrc
seed_profile
copy_patch

# First run: let DSH install the profile bundles (mirror registry is exported).
# A failure is non-fatal; the Bridge still serves and /health reports ACP state.
if [ ! -d "$PROFILE_DIR/node_modules" ]; then
    echo "initializing DSH profile '$DSH_PROFILE'"
    if ! dsh --profile "$DSH_PROFILE" --version; then
        echo "WARNING: DSH profile init failed; continuing without ACP bundles" >&2
    fi
fi

# Re-apply after init in case it rewrote the profile.
copy_patch

exec node /app/dist/src/main.mjs
