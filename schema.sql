CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, google_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sites (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  site_key TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE balloons (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), slug TEXT NOT NULL,
  title TEXT NOT NULL, html TEXT NOT NULL, css TEXT, size TEXT NOT NULL DEFAULT 'responsive',
  status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, slug)
);
CREATE INDEX idx_sites_user ON sites(user_id);
CREATE INDEX idx_balloons_site ON balloons(site_id);
