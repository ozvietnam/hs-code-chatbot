/**
 * Shared utilities for all agents
 * Supports both Gemini and OpenAI-compatible APIs (Groq, etc.)
 */

const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Model allocation:
//   FAST → Gemini (keyword extraction — cần hiểu tiếng Việt không dấu)
//   MEDIUM → Groq (router, care agent — nhẹ, nhanh)
//   HEAVY → Gemini (phân tích 9 tầng — context lớn, không TPM limit)
export const MODELS = {
  FAST:   'gemini',
  MEDIUM: (process.env.LLM_MODEL_MEDIUM || 'meta-llama/llama-4-scout-17b-16e-instruct').trim(),
  HEAVY:  'gemini',
};

/**
 * Call LLM API — auto-detects Gemini vs OpenAI-compatible (Groq, etc.)
 * @param {string} prompt - Text prompt (used as user message)
 * @param {string} apiKey - API key
 * @param {object} [options]
 * @param {object} [options.file] - { mimeType, data (base64) } — Gemini only
 * @param {number} [options.temperature] - 0.0-1.0
 * @param {number} [options.maxTokens] - max output tokens
 * @param {string} [options.systemPrompt] - system message (OpenAI format)
 * @param {string} [options.apiUrl] - override API base URL
 * @param {string} [options.model] - override model name
 */
export async function callLLM(prompt, apiKey, options = {}) {
  const {
    file,
    temperature = 0.2,
    maxTokens = 8192,
    systemPrompt,
    apiUrl = (process.env.LLM_API_URL || 'https://api.groq.com/openai/v1').trim(),
    model = (process.env.LLM_MODEL || 'llama-3.3-70b-versatile').trim(),
    retries = 1,
  } = options;

  const isGemini = model === 'gemini' || apiUrl.includes('generativelanguage.googleapis.com');

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (isGemini) {
        return await callGemini(prompt, apiKey, { file, temperature, maxTokens });
      } else {
        return await callOpenAICompatible(prompt, apiKey, {
          temperature, maxTokens, systemPrompt, apiUrl, model,
        });
      }
    } catch (err) {
      lastError = err;
      // Retry on rate limit (429) or server error (5xx)
      if (attempt < retries && /429|5\d\d|rate|limit|overloaded/i.test(err.message)) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Call Gemini API directly
 */
export async function callGemini(prompt, apiKey, options = {}) {
  const { file, temperature = 0.2, maxTokens = 12000 } = options;
  const parts = [{ text: prompt }];

  if (file?.data && file?.mimeType) {
    parts.push({
      inline_data: { mime_type: file.mimeType, data: file.data },
    });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || apiKey;
  const res = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        // Gemini 2.5 Flash: cap thinking to 1024 tokens, rest for output
        thinkingConfig: { thinkingBudget: 1024 },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0] || {};
  const responseParts = candidate.content?.parts || [];
  const finishReason = candidate.finishReason;

  // Gemini 2.5 Flash thinking: parts may include thinking (thought:true) and response parts
  let responseText = '';
  for (const part of responseParts) {
    if (part.thought !== true && part.text) {
      responseText += part.text;
    }
  }
  // Fallback: if no non-thought part found, use all text parts
  if (!responseText) {
    responseText = responseParts.map(p => p.text || '').join('');
  }

  const result = responseText.trim();
  const usage = data.usageMetadata || {};

  // Log finish details for debugging
  console.log(`[Gemini] finish=${finishReason} output=${result.length}chars thinking_tokens=${usage.thoughtsTokenCount || 0} output_tokens=${usage.candidatesTokenCount || 0} total=${usage.totalTokenCount || 0}`);

  // If response was truncated, append indicator
  if (finishReason === 'MAX_TOKENS' && result.length > 0) {
    console.warn(`[Gemini] TRUNCATED at ${result.length} chars — thinking used ${usage.thoughtsTokenCount || '?'} tokens`);
  }

  return result;
}

/**
 * Call OpenAI-compatible API (Groq, OpenRouter, etc.)
 */
export async function callOpenAICompatible(prompt, apiKey, options = {}) {
  const {
    temperature = 0.2,
    maxTokens = 8192,
    systemPrompt,
    apiUrl = (process.env.LLM_API_URL || 'https://api.groq.com/openai/v1').trim(),
    model = (process.env.LLM_MODEL || 'llama-3.3-70b-versatile').trim(),
  } = options;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  // Strip <think>...</think> tags (Qwen3 thinking mode)
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
export function parseGeminiJSON(raw) {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Format conversation history for prompt
 */
export function formatHistory(history, maxTurns = 6) {
  if (!history?.length) return '';
  return '\nLỊCH SỬ HỘI THOẠI:\n' + history.slice(-maxTurns).map(h =>
    `${h.role === 'user' ? 'Người dùng' : 'Trợ lý'}: ${h.content.substring(0, 500)}`
  ).join('\n') + '\n';
}

/**
 * Load agent profile from profiles directory
 */
export async function loadProfile(agentName) {
  try {
    const profile = await import(`./profiles/${agentName}.json`);
    return profile.default;
  } catch {
    return null;
  }
}
