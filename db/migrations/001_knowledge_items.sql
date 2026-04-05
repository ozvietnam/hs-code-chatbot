-- Knowledge Base schema for HS Code VN Chatbot
-- Run this on Vercel Postgres (Neon) after setup

CREATE TABLE IF NOT EXISTS knowledge_items (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(50) NOT NULL,      -- 'hs_insight', 'confusion', 'precedent', 'pricing', 'regulation'
  content     TEXT NOT NULL,
  hs_codes    VARCHAR(10)[] DEFAULT '{}', -- mã HS liên quan
  confidence  DECIMAL(3,2) DEFAULT 0.50,
  source      VARCHAR(50) DEFAULT 'extraction', -- 'extraction', 'manual', 'scrape:customs_gov_vn'
  created_at  TIMESTAMP DEFAULT NOW(),
  used_count  INTEGER DEFAULT 0          -- tracking tái sử dụng
);

-- Index for fast HS code lookups (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_kb_hs_codes ON knowledge_items USING GIN(hs_codes);

-- Index for type-based queries
CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_items(type);

-- Index for text search
CREATE INDEX IF NOT EXISTS idx_kb_content ON knowledge_items USING GIN(to_tsvector('simple', content));
