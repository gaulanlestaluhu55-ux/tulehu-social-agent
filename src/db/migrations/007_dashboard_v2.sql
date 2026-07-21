-- Migration 007: Dashboard v2.0 schema changes
-- Run this in Supabase SQL Editor

-- 1. Add new columns to content_pipeline
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS scheduled_time TIME;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS idea_options JSONB;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS idea_selected_index INTEGER;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS image_brief JSONB;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS optimized_prompt JSONB;

-- 2. Add scheduled_at to publish_queue
ALTER TABLE publish_queue ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_publish_queue_scheduled
  ON publish_queue(scheduled_at) WHERE status = 'pending';

-- 3. Convert status column from old enum to TEXT first
-- (This脱离旧enum, so DROP TYPE won't cascade-delete the column)
ALTER TABLE content_pipeline ALTER COLUMN status TYPE TEXT;

-- 4. Now safe to drop old enum
DROP TYPE IF EXISTS pipeline_status CASCADE;

-- 5. Create new enum with v2.0 statuses
CREATE TYPE pipeline_status AS ENUM (
  'draft', 'idea_ready', 'script_ready', 'visual_uploaded',
  'caption_ready', 'scheduled', 'publishing', 'published', 'failed'
);

-- 6. Update existing rows to use new status values
UPDATE content_pipeline SET status = 'draft' WHERE status IN ('idea', 'script_drafted');
UPDATE content_pipeline SET status = 'idea_ready' WHERE status = 'awaiting_script_approval';
UPDATE content_pipeline SET status = 'script_ready' WHERE status IN ('script_approved', 'awaiting_asset', 'generating_asset');
UPDATE content_pipeline SET status = 'visual_uploaded' WHERE status = 'awaiting_final_approval';
UPDATE content_pipeline SET status = 'caption_ready' WHERE status = 'approved';
UPDATE content_pipeline SET status = 'publishing' WHERE status = 'publishing';
UPDATE content_pipeline SET status = 'published' WHERE status = 'published';
UPDATE content_pipeline SET status = 'failed' WHERE status = 'failed';

-- 7. Convert column back to new enum type
ALTER TABLE content_pipeline ALTER COLUMN status DROP DEFAULT;
ALTER TABLE content_pipeline ALTER COLUMN status TYPE pipeline_status USING status::pipeline_status;
ALTER TABLE content_pipeline ALTER COLUMN status SET DEFAULT 'draft';

-- 8. Add auth_settings table for dashboard login
CREATE TABLE IF NOT EXISTS auth_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO auth_settings (setting_key, setting_value)
VALUES ('dashboard_password', 'tulehu2026')
ON CONFLICT (setting_key) DO NOTHING;

-- 9. Add conversation_history table if not exists
CREATE TABLE IF NOT EXISTS conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_chat ON conversation_history(chat_id, created_at DESC);

-- 10. Grant permissions
GRANT ALL ON auth_settings TO service_role;
GRANT ALL ON conversation_history TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 11. Updated_at trigger for auth_settings
CREATE OR REPLACE FUNCTION update_auth_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auth_settings_updated_at ON auth_settings;
CREATE TRIGGER auth_settings_updated_at
  BEFORE UPDATE ON auth_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_auth_settings_updated_at();
