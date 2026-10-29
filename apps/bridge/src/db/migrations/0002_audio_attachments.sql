CREATE TABLE audio_attachments (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  client_msg_id       TEXT,
  mime_type           TEXT NOT NULL,
  playback_mime_type  TEXT NOT NULL,
  duration_ms         INTEGER NOT NULL,
  size_bytes          INTEGER NOT NULL,
  original            BLOB NOT NULL,
  playback            BLOB NOT NULL,
  created_at          INTEGER NOT NULL
);

CREATE INDEX idx_audio_attachments_session_created
  ON audio_attachments(session_id, created_at);
