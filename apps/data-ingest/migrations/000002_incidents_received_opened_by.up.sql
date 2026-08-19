ALTER TABLE incidents_received
    ADD COLUMN IF NOT EXISTS opened_by LowCardinality(String) DEFAULT 'unknown';
