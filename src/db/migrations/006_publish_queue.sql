-- Migration 006: publish_queue table + asset_hash column
-- Run: node src/db/migrate.js 006

-- 1. Add asset_hash column to content_pipeline
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS asset_hash TEXT;

-- 2. Create publish_queue table
CREATE TABLE IF NOT EXISTS publish_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES content_pipeline(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'threads', 'tiktok')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'published', 'failed', 'retry')),
  caption_content TEXT,
  hashtags TEXT[],
  asset_url TEXT,
  asset_type TEXT,
  platform_post_id TEXT,
  platform_permalink TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for publish_queue
CREATE INDEX IF NOT EXISTS idx_publish_queue_status ON publish_queue(status);
CREATE INDEX IF NOT EXISTS idx_publish_queue_pipeline ON publish_queue(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_publish_queue_platform ON publish_queue(platform);
CREATE INDEX IF NOT EXISTS idx_publish_queue_created ON publish_queue(created_at DESC);

-- 4. Index for asset_hash
CREATE INDEX IF NOT EXISTS idx_pipeline_asset_hash ON content_pipeline(asset_hash) WHERE asset_hash IS NOT NULL;

-- 5. Updated_at trigger for publish_queue
CREATE OR REPLACE FUNCTION update_publish_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS publish_queue_updated_at ON publish_queue;
CREATE TRIGGER publish_queue_updated_at
  BEFORE UPDATE ON publish_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_publish_queue_updated_at();

-- 6. Grant permissions
ALTER TABLE publish_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON publish_queue TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
