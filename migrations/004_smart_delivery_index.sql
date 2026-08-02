CREATE TABLE IF NOT EXISTS smart_delivery_items (
  balloon_id TEXT NOT NULL REFERENCES balloons(id) ON DELETE CASCADE,
  site_key TEXT NOT NULL,
  slug TEXT NOT NULL,
  editorial_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (balloon_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_smart_delivery_lookup
  ON smart_delivery_items(site_key, topic, editorial_type, balloon_id);
