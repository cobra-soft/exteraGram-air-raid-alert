-- Полная схема D1 после отказа от KV. Идемпотентно, можно гонять повторно.
-- Выполнить один раз: D1 -> ваша база -> Console -> вставить целиком -> Run.

-- Таблица пользователей (уже должна существовать после users_schema.sql)
CREATE TABLE IF NOT EXISTS users (
  chat_id            TEXT PRIMARY KEY,
  sync_token         TEXT,
  oblast_key         TEXT,
  district_key       TEXT,
  region_name        TEXT,
  lang               TEXT,
  notify             INTEGER DEFAULT 1,
  telegram_connected INTEGER DEFAULT 0,
  registered_at      TEXT,
  last_activity      TEXT,
  last_check         TEXT,
  last_alert_state   TEXT,
  last_alert_active  INTEGER,
  last_alert_start   TEXT,
  last_alert_end     TEXT,
  raw                TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (oblast_key, district_key);
CREATE INDEX IF NOT EXISTS idx_users_notify ON users (notify);

-- Общий key-value кэш (снапшот алертов, статус крона, health-check)
CREATE TABLE IF NOT EXISTS cache_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER
);

-- Дедупликация уведомлений (замена tryClaimNotification на старом KV)
CREATE TABLE IF NOT EXISTS notified_events (
  dedupe_key TEXT PRIMARY KEY,
  created_at INTEGER
);

-- Временные ссылки устройство -> telegram chat_id (раньше device:* в KV, TTL 10 минут)
CREATE TABLE IF NOT EXISTS device_links (
  device_id    TEXT PRIMARY KEY,
  chat_id      TEXT,
  lang         TEXT,
  sync_token   TEXT,
  connected_at TEXT,
  expires_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_device_links_expires ON device_links (expires_at);

-- Проверка после применения:
-- SELECT COUNT(*) FROM users;
-- SELECT COUNT(*) FROM cache_kv;
-- SELECT COUNT(*) FROM notified_events;
-- SELECT COUNT(*) FROM device_links;
