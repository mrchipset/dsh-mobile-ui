# All-in-one Docker deployment with GateAway services

- Date: 2026-10-29
- Scope: `deploy/docker-compose.with-gateaway.yml`, `deploy/.env.example`, `deploy/README.md`
- Status: compose-validated; nothing built or started

## Context

The default compose assumes external `llm-gateaway_default`/`backend:4000`. Hosts
without it need one file that includes GateAway while preserving the Gateway DB
(client key/audit) and `dsh-mobile_*` volumes.

## Options considered

1. Extend the default compose file. Rejected: changes the default topology.
2. A Compose profile. Rejected: still mixes external network/volume semantics.
3. A second compose file sharing project name and volumes (chosen).

## Decision

- New file with seven services: `postgres`, `migrate`, `backend`, `ui`, `stt`, `bridge`, `web`.
- All services use the `app` network. Bridge depends on `backend` + `stt` healthy
  and does not join an external gateway network.
- `postgres:16-alpine`, user/db `gateway`, no host port, external volume
  `llm-gateaway_pgdata` (existing client key and audit rows survive).
- `migrate` runs `alembic upgrade head`; `backend` has `/healthz`; `ui` publishes
  `${GATEWAY_UI_PORT:-8080}:80`.
- Local `llm-gateaway-*:local` images by default; optional build contexts use
  `${GATEWAY_REPO:-../../LLM-GateAway}`.
- Gateway env is interpolated from `deploy/.env`: master key, Postgres password,
  provider keys, audit settings. `GATEWAY_DATABASE_URL` embeds the password.
- Bridge DSH env/volumes/health and `web` `8443:443`/certs are unchanged; project
  name and `dsh-mobile_*` volumes are reused. Gateway logs are 10 MB x 3.

## Tradeoffs / risks

- The two variants cannot run together: both publish `8080` and mount the same
  Postgres volume. Stop the old stacks before switching.
- `deploy/.env` is passed wholesale to the Bridge via `env_file`, so Gateway keys
  are present in the Bridge environment though unused there.
- `POSTGRES_PASSWORD` must be URL-safe because it is part of the DSN.
- Migrations run on every start; a failed migration blocks `backend`.
- A fresh host needs the local Gateway images or a valid `GATEWAY_REPO`.

## Verification

- `docker compose -f deploy/docker-compose.with-gateaway.yml config --quiet` -
  passed using `deploy/.env` (no secrets printed).
- `config --services`: `stt`, `postgres`, `migrate`, `backend`, `ui`, `bridge`,
  `web` (all seven).
- Config checks: `gateaway-pgdata` -> external `llm-gateaway_pgdata`; Bridge
  depends on `backend` + `stt` and only joins `app`; UI publishes `8080:80`;
  migrate is `alembic upgrade head`; backend has the expected `GATEWAY_*` keys.
- Not verified: builds/pulls, start, migrations, gateway/ACP, the switch. No
  containers started/stopped; no images built.

## Follow-ups

- Test the switch with a `llm-gateaway_pgdata` backup (old key/audit intact);
  consider explicit Bridge env so Gateway secrets stop reaching the Bridge.
