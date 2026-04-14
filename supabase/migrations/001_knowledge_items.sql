-- WS-001/WS-002: Knowledge Items table for chatbot KB persistence
-- Run once via Supabase SQL Editor or Supabase CLI

CREATE TABLE IF NOT EXISTS knowledge_items (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(50) NOT NULL,
  content     TEXT NOT NULL,
  hs_codes    TEXT[] DEFAULT '{}',
  confidence  DECIMAL(3,2) DEFAULT 0.5,
  source      VARCHAR(50) DEFAULT 'extraction',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  used_count  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kb_hs_codes ON knowledge_items USING GIN(hs_codes);
CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_items(type);

-- Verify
SELECT COUNT(*) FROM knowledge_items;
