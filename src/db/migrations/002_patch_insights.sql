-- Tulehu Social Agent — Patch: tambah kolom yg missing

ALTER TABLE ig_post_insights
  ADD COLUMN IF NOT EXISTS profile_visits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follows_from_post INTEGER DEFAULT 0;
