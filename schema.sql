-- ══════════════════════════════════════════════════════════
--  CheckWork — منصة إدارة الأعمال والإنجاز
--  Cloudflare D1 (SQLite)
--  النموذج: تسجيل ذاتي + بيئات عمل متعددة + قوائم TODO
-- ══════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ─────────── المستخدمون (هوية عالمية) ───────────
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT    NOT NULL UNIQUE,
  password_hash        TEXT    NOT NULL,
  full_name            TEXT    NOT NULL,
  job_title            TEXT    NOT NULL DEFAULT '',
  phone                TEXT    NOT NULL DEFAULT '',
  email                TEXT    NOT NULL DEFAULT '',
  avatar_color         TEXT    NOT NULL DEFAULT '#4f7cff',
  bio                  TEXT    NOT NULL DEFAULT '',
  is_active            INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  token_version        INTEGER NOT NULL DEFAULT 1,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);

-- ─────────── بيئات العمل ───────────
CREATE TABLE IF NOT EXISTS workspaces (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  tagline      TEXT    NOT NULL DEFAULT '',
  owner_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  avatar_color TEXT    NOT NULL DEFAULT '#4f7cff',
  task_due_days INTEGER NOT NULL DEFAULT 7,
  is_personal  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ws_owner ON workspaces (owner_id);

-- ─────────── أعضاء بيئة العمل ───────────
--  role:   owner | admin | member
--  status: pending (بانتظار موافقة المستخدم) | active | declined
CREATE TABLE IF NOT EXISTS members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined')),
  job_title    TEXT    NOT NULL DEFAULT '',
  invited_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  invited_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at  TEXT,
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_user ON members (user_id, status);
CREATE INDEX IF NOT EXISTS idx_members_ws   ON members (workspace_id, status);

-- ─────────── المهمات ───────────
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  assignee_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_by   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  priority     TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status       TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done', 'cancelled')),
  due_date     TEXT,
  result_note  TEXT    NOT NULL DEFAULT '',
  manager_note TEXT    NOT NULL DEFAULT '',
  progress     INTEGER NOT NULL DEFAULT 0,
  assigned_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  read_at      TEXT,
  started_at   TEXT,
  completed_at TEXT,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_ws    ON tasks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assign ON tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due   ON tasks (due_date);

-- ─────────── قوائم TODO ───────────
--  visibility: private (لصاحبها فقط) | workspace (مرئية لأعضاء بيئة العمل)
CREATE TABLE IF NOT EXISTS todos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id INTEGER REFERENCES workspaces (id) ON DELETE CASCADE,
  visibility   TEXT    NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace')),
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  done         INTEGER NOT NULL DEFAULT 0,
  priority     TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos (owner_id, visibility, done);
CREATE INDEX IF NOT EXISTS idx_todos_ws    ON todos (workspace_id, visibility, done);

-- ─────────── التعليقات ───────────
CREATE TABLE IF NOT EXISTS task_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_task ON task_notes (task_id);

-- ─────────── الجلسات ───────────
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent TEXT    NOT NULL DEFAULT '',
  ip         TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- ─────────── سجل النشاط ───────────
CREATE TABLE IF NOT EXISTS activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER REFERENCES workspaces (id) ON DELETE CASCADE,
  entity       TEXT    NOT NULL,
  entity_id    INTEGER,
  actor_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,
  details      TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_ws  ON activity (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_who ON activity (created_at DESC);