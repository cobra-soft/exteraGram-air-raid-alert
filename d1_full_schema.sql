-- Air Raid Alert — полная схема D1 для текущего worker.js.
-- Выполнить один раз в Cloudflare Dashboard → D1 → ваша база → Console.
-- Скрипт идемпотентный: повторный запуск безопасен.
--
-- Без таблицы device_links не работает «вход» плагина: Telegram /start не
-- может сохранить связку устройство → чат, и новый пользователь никогда не
-- попадает в users.

-- 1. Пользователи.
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

-- 2. Кэш снимка тревог, состояние cron и тех.работ.
CREATE TABLE IF NOT EXISTS cache_kv (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER
);

-- 3. Дедупликация уведомлений.
CREATE TABLE IF NOT EXISTS notified_events (
  dedupe_key TEXT PRIMARY KEY,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notified_events_created ON notified_events (created_at);

-- 4. Связка установки плагина с Telegram-чатом (сценарий /start).
CREATE TABLE IF NOT EXISTS device_links (
  device_id    TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL,
  lang         TEXT,
  sync_token   TEXT,
  connected_at TEXT,
  expires_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_links_expires ON device_links (expires_at);
CREATE INDEX IF NOT EXISTS idx_device_links_chat ON device_links (chat_id);

-- Проверка после выполнения:
--   SELECT name FROM sqlite_master WHERE type = 'table';
--   SELECT COUNT(*) AS total FROM users;
--
-- Если таблица users уже существовала в старой схеме и в ней не хватает
-- колонок, INSERT из воркера будет падать. Проверить колонки:
--   PRAGMA table_info(users);
-- Недостающие колонки добавить вручную, например:
--   ALTER TABLE users ADD COLUMN raw TEXT;
