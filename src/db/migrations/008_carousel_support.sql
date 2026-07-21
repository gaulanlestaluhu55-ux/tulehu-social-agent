-- 008: Add carousel support to content_pipeline
-- Backward compatible: existing rows stay as single_image

-- Content type: 'single_image' (default) or 'carousel'
ALTER TABLE content_pipeline
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'single_image';

-- Ensure JSONB columns exist (some may be missing if migration 007 had issues)
ALTER TABLE content_pipeline
  ADD COLUMN IF NOT EXISTS idea_content JSONB,
  ADD COLUMN IF NOT EXISTS idea_options JSONB,
  ADD COLUMN IF NOT EXISTS idea_selected_index INTEGER,
  ADD COLUMN IF NOT EXISTS image_brief JSONB,
  ADD COLUMN IF NOT EXISTS optimized_prompt JSONB;

-- Index for filtering by content type
CREATE INDEX IF NOT EXISTS idx_pipeline_content_type ON content_pipeline (content_type);

COMMENT ON COLUMN content_pipeline.content_type IS 'single_image: 1 brief/prompt/asset. carousel: arrays in brief/prompt/asset columns';

-- Carousel support for publish_queue
ALTER TABLE publish_queue
  ADD COLUMN IF NOT EXISTS asset_urls JSONB,
  ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'single_image';

COMMENT ON COLUMN publish_queue.asset_urls IS 'Array of image URLs for carousel posts. null for single_image.';
COMMENT ON COLUMN publish_queue.content_type IS 'single_image or carousel. Determines how publisher processes the item.';
