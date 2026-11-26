CREATE TABLE IF NOT EXISTS raport_accounts (
  username text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'guru', 'wali_kelas')),
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS raport_sessions (
  token_hash text PRIMARY KEY,
  username text NOT NULL REFERENCES raport_accounts ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS raport_session_expiry ON raport_sessions (expires_at);
CREATE TABLE IF NOT EXISTS raport_login_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS raport_limit_expiry ON raport_login_limits (expires_at);
CREATE TABLE IF NOT EXISTS raport_students (
  id text PRIMARY KEY,
  record jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS raport_student_class ON raport_students ((record->>'classId'));
