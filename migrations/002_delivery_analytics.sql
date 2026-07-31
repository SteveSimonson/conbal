CREATE TABLE IF NOT EXISTS balloon_delivery_counts (
  balloon_id TEXT PRIMARY KEY REFERENCES balloons(id) ON DELETE CASCADE,
  delivery_count INTEGER NOT NULL DEFAULT 0 CHECK (delivery_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
