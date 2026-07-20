-- ══════════════════════════════════════════════
-- TULEHU SOCIAL AGENT — FULL DATABASE SETUP
-- ══════════════════════════════════════════════
-- Buka: https://supabase.com/dashboard/project/_/sql/new
-- Paste seluruh isi file ini, lalu klik "Run"
-- ══════════════════════════════════════════════

-- ─── Enums ────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE pipeline_status AS ENUM (
    'idea', 'script_drafted', 'awaiting_script_approval', 'script_approved',
    'awaiting_asset', 'generating_asset', 'awaiting_final_approval',
    'approved', 'publishing', 'published', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Content Calendar ────────────────────────

CREATE TABLE IF NOT EXISTS content_calendar (
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

CREATE INDEX IF NOT EXISTS idx_calendar_day ON content_calendar(day_of_week, is_active);

-- ─── Content Pipeline ────────────────────────

CREATE TABLE IF NOT EXISTS content_pipeline (
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

CREATE INDEX IF NOT EXISTS idx_pipeline_date ON content_pipeline(calendar_date);
CREATE INDEX IF NOT EXISTS idx_pipeline_status ON content_pipeline(status);

-- ─── Learnings ───────────────────────────────

CREATE TABLE IF NOT EXISTS learnings (
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

CREATE INDEX IF NOT EXISTS idx_learnings_status ON learnings(status);
CREATE INDEX IF NOT EXISTS idx_learnings_pillar ON learnings(pillar_related);

-- ─── Instagram Post Insights ─────────────────

CREATE TABLE IF NOT EXISTS ig_post_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL UNIQUE,
  ig_post_id UUID,
  insights_json JSONB,
  saves_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  comments_sample JSONB,
  shares INTEGER DEFAULT 0,
  profile_visits INTEGER DEFAULT 0,
  follows_from_post INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2),
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_insights_post ON ig_post_insights(post_id);

-- ─── Agent Logs ──────────────────────────────

CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID,
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

CREATE INDEX IF NOT EXISTS idx_logs_pipeline ON agent_logs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON agent_logs(agent_name);
CREATE INDEX IF NOT EXISTS idx_logs_created ON agent_logs(created_at);

-- ─── Provider Health ─────────────────────────

CREATE TABLE IF NOT EXISTS provider_health (
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

-- ─── Conversation History ────────────────────

CREATE TABLE IF NOT EXISTS conversation_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_chat ON conversation_history(chat_id, created_at DESC);

-- ─── Updated_at triggers ─────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
  CREATE TRIGGER update_content_calendar_updated_at
    BEFORE UPDATE ON content_calendar
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_learnings_updated_at
    BEFORE UPDATE ON learnings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════
-- DISABLE RLS UNTUK SEMUA TABEL
-- ══════════════════════════════════════════════

ALTER TABLE content_calendar DISABLE ROW LEVEL SECURITY;
ALTER TABLE content_pipeline DISABLE ROW LEVEL SECURITY;
ALTER TABLE learnings DISABLE ROW LEVEL SECURITY;
ALTER TABLE ig_post_insights DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE provider_health DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_history DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════
-- GRANT PERMISSIONS KE SERVICE_ROLE
-- ══════════════════════════════════════════════

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ══════════════════════════════════════════════
-- DROP POLICY YANG MUNGKIN BLOKIR
-- ══════════════════════════════════════════════

DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON content_calendar; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access" ON content_calendar; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON content_pipeline; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access" ON content_pipeline; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON learnings; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access" ON learnings; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON ig_post_insights; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON ig_post_insights; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON agent_logs; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access" ON agent_logs; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON provider_health; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access" ON provider_health; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow service role" ON conversation_history; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Service role full access" ON conversation_history; EXCEPTION WHEN OTHERS THEN NULL; END $$;
