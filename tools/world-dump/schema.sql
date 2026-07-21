PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parcels (
  id           INTEGER PRIMARY KEY,
  name         TEXT,
  address      TEXT,
  island       TEXT,
  lightmap_url TEXT,
  content      TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_id  INTEGER NOT NULL REFERENCES parcels(id),
  field      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  raw_url    TEXT NOT NULL,
  url        TEXT NOT NULL,
  hash       TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  error      TEXT,
  tries      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_pending ON assets(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_assets_url_done ON assets(url, hash) WHERE status = 'done';
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_parcel_field ON assets(parcel_id, field);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
