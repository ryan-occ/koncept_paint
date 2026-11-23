CREATE TABLE IF NOT EXISTS paint_login_attempts (
  bucket_key text PRIMARY KEY,
  failure_count integer NOT NULL CHECK (failure_count > 0),
  reset_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS paint_login_attempts_reset_at_idx
  ON paint_login_attempts (reset_at);
