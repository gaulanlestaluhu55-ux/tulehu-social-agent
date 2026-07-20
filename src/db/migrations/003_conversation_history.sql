CREATE TABLE IF NOT EXISTS conversation_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_chat
  ON conversation_history(chat_id, created_at DESC);
