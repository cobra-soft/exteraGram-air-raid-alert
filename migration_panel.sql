-- Additive migration for Air Raid Alert admin/Telegram panel.
-- Existing cache_kv and KV namespace records are intentionally untouched.
CREATE TABLE IF NOT EXISTS panel_chats (
  chat_id TEXT PRIMARY KEY,
  chat_type TEXT NOT NULL DEFAULT 'unknown',
  title TEXT,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  last_message_id INTEGER,
  last_message_at INTEGER,
  last_message_text TEXT,
  updated_at TEXT NOT NULL,
  source TEXT
);
CREATE INDEX IF NOT EXISTS idx_panel_chats_last_message ON panel_chats(last_message_at DESC);
CREATE TABLE IF NOT EXISTS panel_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  from_id TEXT,
  from_username TEXT,
  text TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'unknown',
  telegram_date INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE(chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS idx_panel_messages_chat_id ON panel_messages(chat_id,id DESC);
CREATE TABLE IF NOT EXISTS plugin_versions (
  id INTEGER PRIMARY KEY CHECK(id=1),
  latest_version TEXT NOT NULL,
  minimum_version TEXT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  update_url TEXT NOT NULL DEFAULT 'https://t.me/excess_plugins/100',
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO plugin_versions (id,latest_version,minimum_version,changelog,updated_at)
VALUES (1,'1.0.0','1.0.0','Initial version metadata',datetime('now'));
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  audience_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(job_id,chat_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue ON broadcast_recipients(job_id,status,id);
CREATE INDEX IF NOT EXISTS idx_broadcast_chat ON broadcast_recipients(chat_id,id DESC);
CREATE TABLE IF NOT EXISTS simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  oblast_key TEXT NOT NULL,
  district_key TEXT,
  state TEXT NOT NULL CHECK(state IN ('red','yellow','green')),
  started_at TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  ended_at TEXT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_simulations_scope_active ON simulations(scope_key,active,id DESC);


-- Version-check switch. Disabled by default so version notices stay off until enabled by an admin.
CREATE TABLE IF NOT EXISTS plugin_version_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  update_check_enabled INTEGER NOT NULL DEFAULT 0 CHECK(update_check_enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO plugin_version_settings (id, update_check_enabled) VALUES (1, 0);
