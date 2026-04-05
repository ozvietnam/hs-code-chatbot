/**
 * Knowledge Store — Learned knowledge from conversations
 * Uses Neon Postgres in production, in-memory for local dev
 *
 * Table: knowledge_items
 *   id, type, content, hs_codes[], confidence, source, created_at, used_count
 */

let neonSQL = null;
let sqlChecked = false;

function getSQL() {
  if (sqlChecked) return neonSQL;
  sqlChecked = true;
  try {
    if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
      const { neon } = require('@neondatabase/serverless');
      neonSQL = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    }
  } catch {
    neonSQL = null;
  }
  return neonSQL;
}

// In-memory fallback
const memKB = [];
let nextId = 1;

/**
 * Initialize database table (run once on deploy)
 */
export async function initKnowledgeTable() {
  const sql = getSQL();
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id          SERIAL PRIMARY KEY,
      type        VARCHAR(50) NOT NULL,
      content     TEXT NOT NULL,
      hs_codes    VARCHAR(10)[] DEFAULT '{}',
      confidence  DECIMAL(3,2) DEFAULT 0.5,
      source      VARCHAR(50) DEFAULT 'extraction',
      created_at  TIMESTAMP DEFAULT NOW(),
      used_count  INTEGER DEFAULT 0
    )
  `;

  // Create indexes if not exist
  await sql`CREATE INDEX IF NOT EXISTS idx_kb_hs_codes ON knowledge_items USING GIN(hs_codes)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_items(type)`;
}

/**
 * Add a knowledge item (after librarian approval)
 */
export async function addKnowledgeItem({ type, content, hsCodes = [], confidence = 0.5, source = 'extraction' }) {
  const sql = getSQL();

  if (sql) {
    const result = await sql`
      INSERT INTO knowledge_items (type, content, hs_codes, confidence, source)
      VALUES (${type}, ${content}, ${hsCodes}, ${confidence}, ${source})
      RETURNING id
    `;
    return result[0]?.id;
  }

  // In-memory fallback
  const item = {
    id: nextId++,
    type,
    content,
    hs_codes: hsCodes,
    confidence,
    source,
    created_at: new Date().toISOString(),
    used_count: 0,
  };
  memKB.push(item);
  return item.id;
}

/**
 * Search knowledge by HS codes
 */
export async function searchByHSCodes(hsCodes, limit = 5) {
  const sql = getSQL();

  if (sql) {
    const result = await sql`
      SELECT * FROM knowledge_items
      WHERE hs_codes && ${hsCodes}
      ORDER BY used_count DESC, confidence DESC
      LIMIT ${limit}
    `;
    return result;
  }

  // In-memory fallback
  return memKB
    .filter(item => item.hs_codes.some(c => hsCodes.includes(c)))
    .sort((a, b) => (b.used_count - a.used_count) || (b.confidence - a.confidence))
    .slice(0, limit);
}

/**
 * Search knowledge by type
 */
export async function searchByType(type, limit = 10) {
  const sql = getSQL();

  if (sql) {
    const result = await sql`
      SELECT * FROM knowledge_items
      WHERE type = ${type}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result;
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
  const sql = getSQL();

  if (sql) {
    const result = await sql`
      SELECT * FROM knowledge_items
      WHERE content ILIKE ${'%' + query + '%'}
      ORDER BY confidence DESC, used_count DESC
      LIMIT ${limit}
    `;
    return result;
  }

  const q = query.toLowerCase();
  return memKB
    .filter(item => item.content.toLowerCase().includes(q))
    .sort((a, b) => (b.confidence - a.confidence) || (b.used_count - a.used_count))
    .slice(0, limit);
}

/**
 * Increment used_count for items that were used in a response
 */
export async function trackUsage(itemIds) {
  if (!itemIds?.length) return;
  const sql = getSQL();

  if (sql) {
    await sql`
      UPDATE knowledge_items
      SET used_count = used_count + 1
      WHERE id = ANY(${itemIds})
    `;
  } else {
    for (const item of memKB) {
      if (itemIds.includes(item.id)) item.used_count++;
    }
  }
}

/**
 * Check for duplicate content
 */
export async function findDuplicate(content, type) {
  const sql = getSQL();

  if (sql) {
    const result = await sql`
      SELECT id, content FROM knowledge_items
      WHERE type = ${type}
      AND content ILIKE ${'%' + content.substring(0, 100) + '%'}
      LIMIT 1
    `;
    return result[0] || null;
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
  const sql = getSQL();

  if (sql) {
    const result = await sql`
      SELECT type, COUNT(*) as count, SUM(used_count) as total_uses
      FROM knowledge_items
      GROUP BY type
    `;
    return result;
  }

  const stats = {};
  for (const item of memKB) {
    if (!stats[item.type]) stats[item.type] = { type: item.type, count: 0, total_uses: 0 };
    stats[item.type].count++;
    stats[item.type].total_uses += item.used_count;
  }
  return Object.values(stats);
}
