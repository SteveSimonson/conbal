CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, google_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sites (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  site_key TEXT UNIQUE NOT NULL, origin_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE balloons (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), slug TEXT NOT NULL,
  title TEXT NOT NULL, html TEXT NOT NULL, css TEXT, size TEXT NOT NULL DEFAULT 'responsive',
  editorial_type TEXT NOT NULL DEFAULT 'did_you_know', topics TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, slug)
);
CREATE TABLE balloon_delivery_counts (
  balloon_id TEXT PRIMARY KEY REFERENCES balloons(id) ON DELETE CASCADE,
  delivery_count INTEGER NOT NULL DEFAULT 0 CHECK (delivery_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE smart_delivery_items (
  balloon_id TEXT NOT NULL REFERENCES balloons(id) ON DELETE CASCADE,
  site_key TEXT NOT NULL, slug TEXT NOT NULL, editorial_type TEXT NOT NULL,
  topic TEXT NOT NULL, headline TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (balloon_id, topic)
);
CREATE INDEX idx_sites_user ON sites(user_id);
CREATE INDEX idx_balloons_site ON balloons(site_id);
CREATE INDEX idx_balloons_site_status_size ON balloons(site_id, status, size);
CREATE INDEX idx_smart_delivery_lookup ON smart_delivery_items(site_key, topic, editorial_type, balloon_id);

CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  page_url TEXT NOT NULL,
  page_kind TEXT NOT NULL,
  page_title TEXT NOT NULL,
  page_fingerprint TEXT NOT NULL,
  requested_count INTEGER NOT NULL CHECK (requested_count >= 0 AND requested_count <= 8),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0 AND completed_count <= requested_count),
  profile_json TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_generation_jobs_owner ON generation_jobs(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_generation_active_site ON generation_jobs(site_id) WHERE status IN ('queued', 'running');

CREATE TABLE generation_items (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  balloon_id TEXT NOT NULL REFERENCES balloons(id) ON DELETE CASCADE,
  source_urls TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, balloon_id)
);

CREATE INDEX idx_generation_items_balloon ON generation_items(balloon_id);
