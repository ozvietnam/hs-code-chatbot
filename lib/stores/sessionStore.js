/**
 * Session Store — Conversation memory
 * Uses Upstash Redis in production, in-memory Map for local dev
 *
 * Session format:
 *   session:{id}:messages → [{role, content, agent, timestamp}]
 *   session:{id}:meta     → {created, lastActive, messageCount}
 */

let redisClient = null;
let redisChecked = false;

function getRedis() {
  if (redisChecked) return redisClient;
  redisChecked = true;
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const { Redis } = require('@upstash/redis');
      redisClient = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
    }
  } catch {
    redisClient = null;
  }
  return redisClient;
}

// In-memory fallback for local development
const memStore = new Map();

const SESSION_TTL = 24 * 60 * 60; // 24h for messages
const META_TTL = 7 * 24 * 60 * 60; // 7d for metadata

/**
 * Save a message pair (user + assistant) to session
 */
export async function saveMessages(sessionId, userMsg, assistantMsg, agent) {
  const timestamp = new Date().toISOString();
  const entries = [
    { role: 'user', content: userMsg, agent: null, timestamp },
    { role: 'assistant', content: assistantMsg, agent, timestamp },
  ];

  const redis = getRedis();
  const msgKey = `session:${sessionId}:messages`;
  const metaKey = `session:${sessionId}:meta`;

  if (redis) {
    const existing = await redis.get(msgKey) || [];
    existing.push(...entries);
    const trimmed = existing.slice(-20);
    await redis.set(msgKey, trimmed, { ex: SESSION_TTL });

    const meta = await redis.get(metaKey) || { created: timestamp, messageCount: 0 };
    meta.lastActive = timestamp;
    meta.messageCount = (meta.messageCount || 0) + 2;
    await redis.set(metaKey, meta, { ex: META_TTL });
  } else {
    const existing = memStore.get(msgKey) || [];
    existing.push(...entries);
    memStore.set(msgKey, existing.slice(-20));

    const meta = memStore.get(metaKey) || { created: timestamp, messageCount: 0 };
    meta.lastActive = timestamp;
    meta.messageCount = (meta.messageCount || 0) + 2;
    memStore.set(metaKey, meta);
  }
}

/**
 * Get session messages
 */
export async function getSessionMessages(sessionId) {
  const redis = getRedis();
  const msgKey = `session:${sessionId}:messages`;

  if (redis) {
    return await redis.get(msgKey) || [];
  }
  return memStore.get(msgKey) || [];
}

/**
 * Get session metadata
 */
export async function getSessionMeta(sessionId) {
  const redis = getRedis();
  const metaKey = `session:${sessionId}:meta`;

  if (redis) {
    return await redis.get(metaKey);
  }
  return memStore.get(metaKey);
}

/**
 * List all sessions with metadata (for extraction pipeline)
 */
export async function listSessions() {
  const redis = getRedis();

  if (redis) {
    // Upstash Redis: scan for session meta keys
    let cursor = 0;
    const keys = [];
    do {
      const result = await redis.scan(cursor, { match: 'session:*:meta', count: 100 });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== 0);

    const sessions = [];
    for (const key of keys) {
      const meta = await redis.get(key);
      const sessionId = key.replace('session:', '').replace(':meta', '');
      sessions.push({ sessionId, ...meta });
    }
    return sessions;
  }

  // In-memory fallback
  const sessions = [];
  for (const [key, meta] of memStore.entries()) {
    if (key.endsWith(':meta')) {
      const sessionId = key.replace('session:', '').replace(':meta', '');
      sessions.push({ sessionId, ...meta });
    }
  }
  return sessions;
}

// ============================================================
// PROPOSAL QUEUE — bridge between extract and review crons
// ============================================================
const PROPOSALS_KEY = 'pipeline:pending_proposals';
const PROPOSALS_TTL = 7 * 24 * 60 * 60; // 7 days

/**
 * Store proposals for later review
 */
export async function storeProposals(proposals) {
  if (!proposals?.length) return;
  const redis = getRedis();
  if (redis) {
    const existing = await redis.get(PROPOSALS_KEY) || [];
    existing.push(...proposals);
    await redis.set(PROPOSALS_KEY, existing, { ex: PROPOSALS_TTL });
  } else {
    const existing = memStore.get(PROPOSALS_KEY) || [];
    existing.push(...proposals);
    memStore.set(PROPOSALS_KEY, existing);
  }
}

/**
 * Retrieve and clear pending proposals
 */
export async function consumeProposals() {
  const redis = getRedis();
  if (redis) {
    const proposals = await redis.get(PROPOSALS_KEY) || [];
    if (proposals.length > 0) {
      await redis.del(PROPOSALS_KEY);
    }
    return proposals;
  }
  const proposals = memStore.get(PROPOSALS_KEY) || [];
  memStore.delete(PROPOSALS_KEY);
  return proposals;
}

// ============================================================
// USER FEEDBACK — store thumbs up/down from chat UI
// ============================================================
const FEEDBACK_KEY = 'pipeline:user_feedback';

/**
 * Save user feedback for a message
 */
export async function saveFeedback(sessionId, messageIndex, rating) {
  const redis = getRedis();
  const entry = { sessionId, messageIndex, rating, timestamp: new Date().toISOString() };
  if (redis) {
    const existing = await redis.get(FEEDBACK_KEY) || [];
    existing.push(entry);
    await redis.set(FEEDBACK_KEY, existing, { ex: PROPOSALS_TTL });
  } else {
    const existing = memStore.get(FEEDBACK_KEY) || [];
    existing.push(entry);
    memStore.set(FEEDBACK_KEY, existing);
  }
}

/**
 * Mark session as extracted (to avoid re-processing)
 */
export async function markSessionExtracted(sessionId) {
  const redis = getRedis();
  const metaKey = `session:${sessionId}:meta`;

  if (redis) {
    const meta = await redis.get(metaKey);
    if (meta) {
      meta.extracted = true;
      meta.extractedAt = new Date().toISOString();
      await redis.set(metaKey, meta, { ex: META_TTL });
    }
  } else {
    const meta = memStore.get(metaKey);
    if (meta) {
      meta.extracted = true;
      meta.extractedAt = new Date().toISOString();
    }
  }
}
