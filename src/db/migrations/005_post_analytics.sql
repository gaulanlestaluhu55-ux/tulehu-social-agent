-- 005_post_analytics.sql
-- Tabel untuk menyimpan analisis performa postingan Instagram

CREATE TABLE IF NOT EXISTS post_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ig_media_id TEXT UNIQUE NOT NULL,
  caption TEXT,
  media_type TEXT,
  media_url TEXT,
  permalink TEXT,
  timestamp TIMESTAMPTZ,
  like_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  -- Insights dari Instagram API
  saves INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  profile_visits INTEGER DEFAULT 0,
  follows INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  -- Engagement rate
  engagement_rate NUMERIC(5,2) DEFAULT 0,
  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_post_analytics_ig_media_id ON post_analytics(ig_media_id);
CREATE INDEX IF NOT EXISTS idx_post_analytics_timestamp ON post_analytics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_post_analytics_engagement ON post_analytics(engagement_rate DESC);

-- Disable RLS
ALTER TABLE post_analytics DISABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL ON post_analytics TO service_role;
GRANT ALL ON post_analytics TO authenticated;
