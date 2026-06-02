import { classifyIntent } from '../../lib/agents/router';
import { handleCustoms } from '../../lib/agents/customsAgent';
import { handleCare } from '../../lib/agents/careAgent';
import { handlePricing } from '../../lib/agents/pricingAgent';
import { handleRegulation } from '../../lib/agents/regulationAgent';
import { saveMessages } from '../../lib/stores/sessionStore';

// ═══════════════════════════════════════════════════════
// RATE LIMITER — Simple in-memory with Redis fallback
// ═══════════════════════════════════════════════════════
const memoryStore = new Map();
const RATE_LIMIT_WINDOW = 3600 * 1000; // 1 hour
const RATE_LIMIT_MAX = 100; // 100 requests per hour per IP

async function checkRateLimit(ip) {
  const key = `rl:${ip}`;
  const now = Date.now();

  // Memory-based (always works)
  if (!memoryStore.has(key)) {
    memoryStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW };
  }

  const record = memoryStore.get(key);

  // Window expired
  if (now > record.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW };
  }

  // Check limit
  if (record.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: record.resetAt,
      retryAfter: Math.ceil((record.resetAt - now) / 1000)
    };
  }

  record.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count, resetAt: record.resetAt };
}

// Body parser config — increase limit for file uploads
export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

// Agent dispatch map
const AGENTS = {
  customs: handleCustoms,
  care: handleCare,
  pricing: handlePricing,
  regulation: handleRegulation,
};

/**
 * Determine effective intent based on classification + context
 */
function resolveIntent(intent, confidence, file) {
  // File attached → always customs (HS classification from image/PDF)
  if (file) return 'customs';
  // Low confidence → fallback to care
  if (confidence < 0.6) return 'care';
  return intent;
}

/**
 * Chat API — Multi-Agent Dispatcher
 * Routes requests to specialized agents based on intent classification
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, history, file, sessionId } = req.body;
  if (!message?.trim() && !file) {
    return res.status(400).json({ error: 'Message or file is required' });
  }

  // ═══════════════════════════════════════════════════════
  // INPUT VALIDATION
  // ═══════════════════════════════════════════════════════
  const maxMessageLength = parseInt(process.env.MAX_MESSAGE_LENGTH || '5000', 10);
  const maxHistoryLength = parseInt(process.env.MAX_HISTORY_LENGTH || '50', 10);

  if (message?.trim() && message.trim().length > maxMessageLength) {
    return res.status(400).json({
      error: `Message too long (max ${maxMessageLength} chars). Current: ${message.trim().length}.`
    });
  }

  if (Array.isArray(history) && history.length > maxHistoryLength) {
    return res.status(400).json({
      error: `History too long (max ${maxHistoryLength} messages). Current: ${history.length}.`
    });
  }

  // Validate history format
  if (Array.isArray(history)) {
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (!msg.role || !msg.content) {
        return res.status(400).json({
          error: `Invalid message at index ${i}: must have 'role' and 'content'`
        });
      }
      if (!['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({
          error: `Invalid role at index ${i}: must be 'user' or 'assistant'`
        });
      }
    }
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    return res.status(500).json({ error: 'LLM_API_KEY chưa được cấu hình' });
  }

  // ═══════════════════════════════════════════════════════
  // RATE LIMITING CHECK
  // ═══════════════════════════════════════════════════════
  const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
  const rateLimitCheck = await checkRateLimit(clientIp);

  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: rateLimitCheck.retryAfter,
      resetAt: new Date(rateLimitCheck.resetAt).toISOString()
    });
  }

  // Add rate limit headers to response
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimitCheck.remaining.toString());
  res.setHeader('X-RateLimit-Reset', new Date(rateLimitCheck.resetAt).toISOString());

  const startTime = Date.now();
  let routing = {};

  try {
    // Step 1: Classify intent
    const { intent, confidence } = await classifyIntent(message, apiKey, history);
    const effectiveIntent = resolveIntent(intent, confidence, file);
    routing = { intent, confidence, effectiveIntent };

    // Step 2: Dispatch to agent
    const agentFn = AGENTS[effectiveIntent] || AGENTS.care;
    let result;

    try {
      result = await agentFn({ message, history, file, apiKey });
    } catch (agentError) {
      console.error(`Agent [${effectiveIntent}] failed:`, agentError.message);
      if (effectiveIntent !== 'care') {
        // Return error message visible to user instead of silent care fallback
        result = {
          reply: `⚠️ **Lỗi xử lý yêu cầu**\n\nHệ thống phân tích hải quan gặp sự cố khi xử lý câu hỏi của bạn.\n\n**Chi tiết:** ${agentError.message}\n\nVui lòng thử lại hoặc mô tả hàng hóa chi tiết hơn.`,
          debug: {
            agent: effectiveIntent,
            error: agentError.message,
            fallback: false,
          },
        };
      } else {
        throw agentError;
      }
    }

    // Step 3: Save conversation to session store (async, non-blocking)
    if (sessionId) {
      saveMessages(sessionId, message, result.reply, effectiveIntent).catch(e =>
        console.error('Session save error:', e.message)
      );
    }

    // Add routing + timing + backend info to debug
    result.debug = {
      ...result.debug,
      routing,
      timing: { totalMs: Date.now() - startTime },
      storageBackend: process.env.POSTGRES_URL || process.env.DATABASE_URL ? 'Neon Postgres' : 'In-memory (dev)',
      sessionBackend: process.env.KV_REST_API_URL ? 'Upstash Redis' : 'In-memory (dev)',
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({
      error: `Lỗi xử lý: ${error.message}`,
      debug: {
        routing,
        error: error.message,
        timing: { totalMs: Date.now() - startTime },
      },
    });
  }
}
