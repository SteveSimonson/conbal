ALTER TABLE sites ADD COLUMN origin_url TEXT;

CREATE TABLE IF NOT EXISTS generation_jobs (
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

CREATE INDEX IF NOT EXISTS idx_generation_jobs_owner ON generation_jobs(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_active_site ON generation_jobs(site_id) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS generation_items (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  balloon_id TEXT NOT NULL REFERENCES balloons(id) ON DELETE CASCADE,
  source_urls TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, balloon_id)
);

CREATE INDEX IF NOT EXISTS idx_generation_items_balloon ON generation_items(balloon_id);
