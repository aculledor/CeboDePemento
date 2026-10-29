ALTER TABLE photos ADD COLUMN remote_url TEXT;
ALTER TABLE photos ADD COLUMN remote_thumbnail TEXT;
ALTER TABLE photos ADD COLUMN provider TEXT NOT NULL DEFAULT 'manual';
