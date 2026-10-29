CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  cwd             TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  next_seq        INTEGER NOT NULL DEFAULT 1,
  archived        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE updates (
  session_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prompt_receipts (
  client_msg_id TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  state         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE mcp_status (
  server      TEXT PRIMARY KEY,
  transport   TEXT NOT NULL,
  state       TEXT NOT NULL,
  since       INTEGER NOT NULL,
  last_error  TEXT,
  source      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
