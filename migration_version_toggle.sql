-- Safe standalone migration; also works if plugin_version_settings already exists.
CREATE TABLE IF NOT EXISTS plugin_version_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  update_check_enabled INTEGER NOT NULL DEFAULT 0 CHECK(update_check_enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO plugin_version_settings (id, update_check_enabled) VALUES (1, 0);
