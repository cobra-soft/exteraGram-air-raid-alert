-- Air Raid Alert: таблица пользователей для переезда с KV на D1.
-- Выполнить один раз: D1 -> ваша база -> Console -> вставить содержимое -> Run.
-- Файл идемпотентный, повторный запуск безопасен.

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

-- Проверка после импорта:
-- SELECT COUNT(*) AS total FROM users;
-- SELECT COUNT(*) AS with_region FROM users WHERE oblast_key IS NOT NULL;
-- SELECT COUNT(*) AS notifying FROM users WHERE notify = 1;
