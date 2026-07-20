-- Fix RLS + Conversation History
-- Jalankan ini di Supabase SQL Editor manual

-- ─── Conversation History ──────────────

CREATE TABLE IF NOT EXISTS conversation_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_chat
  ON conversation_history(chat_id, created_at DESC);

-- ─── Disable RLS untuk semua tabel ─────

ALTER TABLE content_calendar DISABLE ROW LEVEL SECURITY;
ALTER TABLE content_pipeline DISABLE ROW LEVEL SECURITY;
ALTER TABLE learnings DISABLE ROW LEVEL SECURITY;
ALTER TABLE ig_post_insights DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE provider_health DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_history DISABLE ROW LEVEL SECURITY;

-- ─── Grant permissions ke service_role ─

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ─── Drop semua RLS policies yang mungkin blokir ─

-- Content Calendar
DROP POLICY IF EXISTS "Allow service role" ON content_calendar;
DROP POLICY IF EXISTS "Service role full access" ON content_calendar;

-- Content Pipeline
DROP POLICY IF EXISTS "Allow service role" ON content_pipeline;
DROP POLICY IF EXISTS "Service role full access" ON content_pipeline;

-- Learnings
DROP POLICY IF EXISTS "Allow service role" ON learnings;
DROP POLICY IF EXISTS "Service role full access" ON learnings;

-- IG Post Insights
DROP POLICY IF EXISTS "Allow service role" ON ig_post_insights;
DROP POLICY IF EXISTS "Service role full access" ON ig_post_insights;

-- Agent Logs
DROP POLICY IF EXISTS "Allow service role" ON agent_logs;
DROP POLICY IF EXISTS "Service role full access" ON agent_logs;

-- Provider Health
DROP POLICY IF EXISTS "Allow service role" ON provider_health;
DROP POLICY IF EXISTS "Service role full access" ON provider_health;

-- Conversation History
DROP POLICY IF EXISTS "Allow service role" ON conversation_history;
DROP POLICY IF EXISTS "Service role full access" ON conversation_history;
