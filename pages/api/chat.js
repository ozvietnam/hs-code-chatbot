import { classifyIntent } from '../../lib/agents/router';
import { handleCustoms } from '../../lib/agents/customsAgent';
import { handleCare } from '../../lib/agents/careAgent';
import { handlePricing } from '../../lib/agents/pricingAgent';
import { handleRegulation } from '../../lib/agents/regulationAgent';
import { saveMessages } from '../../lib/stores/sessionStore';

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

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    return res.status(500).json({ error: 'LLM_API_KEY chưa được cấu hình' });
  }

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
      // Agent-level fallback: if specific agent fails, try care agent
      console.error(`Agent [${effectiveIntent}] failed:`, agentError.message);
      if (effectiveIntent !== 'care') {
        result = await AGENTS.care({ message, history, apiKey });
        result.debug = {
          ...result.debug,
          fallback: { from: effectiveIntent, error: agentError.message },
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
