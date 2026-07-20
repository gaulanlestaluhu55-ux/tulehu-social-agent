-- Tulehu Social Agent — Database Schema
-- Jalankan di Supabase SQL Editor

-- ─── Enums ──────────────────────────

CREATE TYPE pipeline_status AS ENUM (
  'idea', 'script_drafted', 'awaiting_script_approval', 'script_approved',
  'awaiting_asset', 'generating_asset', 'awaiting_final_approval',
  'approved', 'publishing', 'published', 'failed'
);

-- ─── Content Calendar ──────────────

CREATE TABLE content_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  pillar_name TEXT NOT NULL,
  needs_real_photo BOOLEAN DEFAULT false,
  priority_override TEXT,
  fallback_ai_pillar TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendar_day ON content_calendar(day_of_week, is_active);

-- ─── Content Pipeline ──────────────

CREATE TABLE content_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_date DATE NOT NULL,
  pillar_name TEXT NOT NULL,
  status pipeline_status NOT NULL DEFAULT 'idea',
  idea_content JSONB,
  script_content JSONB,
  needs_real_photo BOOLEAN DEFAULT false,
  asset_url TEXT,
  asset_type TEXT,
  caption_content TEXT,
  hashtags TEXT[],
  revision_notes JSONB,
  revision_count_gate1 INTEGER DEFAULT 0,
  revision_count_gate2 INTEGER DEFAULT 0,
  ig_post_id TEXT,
  ig_permalink TEXT,
  error_log TEXT,
  fallback_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_date ON content_pipeline(calendar_date);
CREATE INDEX idx_pipeline_status ON content_pipeline(status);

-- ─── Learnings ──────────────────────

CREATE TABLE learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_summary TEXT NOT NULL,
  pillar_related TEXT,
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')) DEFAULT 'low',
  based_on_post_count INTEGER DEFAULT 1,
  evidence_notes TEXT,
  status TEXT CHECK (status IN ('active', 'deprecated')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learnings_status ON learnings(status);
CREATE INDEX idx_learnings_pillar ON learnings(pillar_related);

-- ─── Instagram Post Insights ──────

CREATE TABLE ig_post_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL UNIQUE,
  ig_post_id UUID REFERENCES content_pipeline(id),
  insights_json JSONB,
  saves_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  comments_sample JSONB,
  shares INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2),
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ig_insights_post ON ig_post_insights(post_id);

-- ─── Agent Logs ────────────────────

CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES content_pipeline(id),
  agent_name TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT CHECK (status IN ('success', 'error', 'rate_limited', 'timeout')) DEFAULT 'success',
  provider_used TEXT,
  model_used TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_pipeline ON agent_logs(pipeline_id);
CREATE INDEX idx_logs_agent ON agent_logs(agent_name);
CREATE INDEX idx_logs_created ON agent_logs(created_at);

-- ─── Provider Health ──────────────

CREATE TABLE provider_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT UNIQUE NOT NULL,
  status TEXT CHECK (status IN ('healthy', 'degraded', 'down')) DEFAULT 'healthy',
  daily_requests INTEGER DEFAULT 0,
  daily_limit INTEGER,
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TIMESTAMPTZ,
  last_error TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Updated_at trigger ────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_content_calendar_updated_at
  BEFORE UPDATE ON content_calendar
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learnings_updated_at
  BEFORE UPDATE ON learnings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
