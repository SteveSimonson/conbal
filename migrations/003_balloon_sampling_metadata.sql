ALTER TABLE balloons ADD COLUMN editorial_type TEXT NOT NULL DEFAULT 'did_you_know';
ALTER TABLE balloons ADD COLUMN topics TEXT NOT NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS idx_balloons_site_status_size ON balloons(site_id, status, size);
