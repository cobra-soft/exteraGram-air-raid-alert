-- Apply once if migration_panel.sql has already been applied.
-- Adds an editable HTTPS download/post URL; defaults to the official Telegram post supplied by the project owner.
ALTER TABLE plugin_versions ADD COLUMN update_url TEXT NOT NULL DEFAULT 'https://t.me/excess_plugins/100';
