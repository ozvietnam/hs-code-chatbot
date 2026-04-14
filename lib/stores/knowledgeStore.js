/**
 * Knowledge Store — Learned knowledge from conversations
 * Uses Supabase REST API in production, in-memory for local dev
 *
 * Table: knowledge_items
 *   id, type, content, hs_codes[], confidence, source, created_at, used_count
 */

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

function isSupaAvailable() {
  return !!(SUPA_URL && SUPA_KEY);
}

function supaHeaders() {
  return {
    'apikey': SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function supaFetch(path, options = {}) {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      ...options,
      headers: { ...supaHeaders(), ...(options.headers || {}) },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch {
    return null;
  }
}

// In-memory fallback
const memKB = [];
let nextId = 1;

/**
 * Initialize database table (run once on deploy)
 * Supabase: table must be pre-created via SQL editor or init-db endpoint
 */
export async function initKnowledgeTable() {
  // Supabase REST API doesn't support DDL — table is created via /api/admin/init-db
  // which calls Supabase's SQL execution endpoint with service role key
  if (!isSupaAvailable()) return;

  const body = JSON.stringify({
    query: `
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
    `
  });

  await fetch(`${SUPA_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: supaHeaders(),
    body,
  }).catch(() => {});
}

/**
 * Add a knowledge item (after librarian approval) — WS-001
 */
export async function addKnowledgeItem({ type, content, hsCodes = [], confidence = 0.5, source = 'extraction' }) {
  if (isSupaAvailable()) {
    const result = await supaFetch('knowledge_items', {
      method: 'POST',
      body: JSON.stringify({ type, content, hs_codes: hsCodes, confidence, source }),
    });
    return result?.[0]?.id ?? null;
  }

  const item = {
    id: nextId++, type, content,
    hs_codes: hsCodes, confidence, source,
    created_at: new Date().toISOString(), used_count: 0,
  };
  memKB.push(item);
  return item.id;
}

/**
 * Search knowledge by HS codes
 */
export async function searchByHSCodes(hsCodes, limit = 5) {
  if (isSupaAvailable() && hsCodes.length > 0) {
    // Use cs (contains) operator for array overlap
    const filter = hsCodes.map(c => `hs_codes.cs.{${c}}`).join(',');
    const result = await supaFetch(
      `knowledge_items?or=(${filter})&order=used_count.desc,confidence.desc&limit=${limit}`
    );
    return result || [];
  }

  return memKB
    .filter(item => item.hs_codes.some(c => hsCodes.includes(c)))
    .sort((a, b) => (b.used_count - a.used_count) || (b.confidence - a.confidence))
    .slice(0, limit);
}

/**
 * Search knowledge by type
 */
export async function searchByType(type, limit = 10) {
  if (isSupaAvailable()) {
    const result = await supaFetch(
      `knowledge_items?type=eq.${encodeURIComponent(type)}&order=created_at.desc&limit=${limit}`
    );
    return result || [];
  }

  return memKB
    .filter(item => item.type === type)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

/**
 * Search knowledge by text content
 */
export async function searchByContent(query, limit = 5) {
  if (isSupaAvailable()) {
    const result = await supaFetch(
      `knowledge_items?content=ilike.*${encodeURIComponent(query)}*&order=confidence.desc,used_count.desc&limit=${limit}`
    );
    return result || [];
  }

  const q = query.toLowerCase();
  return memKB
    .filter(item => item.content.toLowerCase().includes(q))
    .sort((a, b) => (b.confidence - a.confidence) || (b.used_count - a.used_count))
    .slice(0, limit);
}

/**
 * Increment used_count for items that were used — WS-002 feedback loop
 */
export async function trackUsage(itemIds) {
  if (!itemIds?.length) return;

  if (isSupaAvailable()) {
    await supaFetch(`knowledge_items?id=in.(${itemIds.join(',')})`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ used_count: 'used_count + 1' }),
    });
    return;
  }

  for (const item of memKB) {
    if (itemIds.includes(item.id)) item.used_count++;
  }
}

/**
 * Check for duplicate content
 */
export async function findDuplicate(content, type) {
  if (isSupaAvailable()) {
    const snippet = encodeURIComponent(content.substring(0, 100));
    const result = await supaFetch(
      `knowledge_items?type=eq.${encodeURIComponent(type)}&content=ilike.*${snippet}*&limit=1`
    );
    return result?.[0] || null;
  }

  return memKB.find(item =>
    item.type === type &&
    item.content.toLowerCase().includes(content.substring(0, 100).toLowerCase())
  ) || null;
}

/**
 * Get knowledge stats
 */
export async function getKnowledgeStats() {
  if (isSupaAvailable()) {
    const result = await supaFetch('knowledge_items?select=type,used_count');
    if (result) {
      const stats = {};
      for (const item of result) {
        if (!stats[item.type]) stats[item.type] = { type: item.type, count: 0, total_uses: 0 };
        stats[item.type].count++;
        stats[item.type].total_uses += item.used_count || 0;
      }
      return Object.values(stats);
    }
  }

  const stats = {};
  for (const item of memKB) {
    if (!stats[item.type]) stats[item.type] = { type: item.type, count: 0, total_uses: 0 };
    stats[item.type].count++;
    stats[item.type].total_uses += item.used_count;
  }
  return Object.values(stats);
}
