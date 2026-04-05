import { callLLM, MODELS } from './shared';
import routerConfig from '../data/router-config.json';

const CLASSIFY_PROMPT = `Bạn là bộ phân loại intent cho chatbot hải quan Việt Nam.
Phân loại tin nhắn người dùng vào ĐÚNG 1 trong 4 loại:

1. **customs** — Hỏi về mã HS, phân loại hàng hóa, thuế suất, C/O, xuất xứ, ECUS
   VD: "mã HS của gạo", "thuế nhập khẩu thép", "phân loại máy bơm", kèm ảnh/file sản phẩm

2. **care** — Chào hỏi, hướng dẫn sử dụng, câu hỏi chung, cảm ơn, phàn nàn
   VD: "xin chào", "chatbot này làm gì", "cảm ơn", "tôi cần giúp đỡ"

3. **pricing** — Hỏi báo giá dịch vụ, chi phí khai báo, cước tàu, phí ủy thác
   VD: "báo giá khai báo hải quan", "phí dịch vụ thông quan", "cước tàu Hải Phòng"

4. **regulation** — Hỏi về văn bản pháp luật, thông tư, nghị định, quy định hải quan
   VD: "Thông tư 38 quy định gì", "thủ tục nhập khẩu ô tô", "quy định mới về ECUS"

Trả lời ĐÚNG JSON, không text khác:
{"intent": "customs|care|pricing|regulation", "confidence": 0.0-1.0}`;

/**
 * Load router config — re-reads at runtime so admin changes take effect
 */
function getConfig() {
  try {
    // In dev, require cache is cleared on file change via HMR
    // In production, this reads the file that was updated via admin API
    delete require.cache[require.resolve('../data/router-config.json')];
    return require('../data/router-config.json');
  } catch {
    return routerConfig; // fallback to import
  }
}

/**
 * Classify user message intent
 * @returns {{ intent: string, confidence: number, method: string }}
 */
export async function classifyIntent(message, apiKey, history) {
  const config = getConfig();
  const { keywords, thresholds } = config;
  const lowerMsg = message.toLowerCase();

  // Quick keyword check
  for (const [intent, kwList] of Object.entries(keywords)) {
    if (kwList.some(k => lowerMsg.includes(k))) {
      return { intent, confidence: thresholds.keywordMatchConfidence, method: 'keyword' };
    }
  }

  // Short message heuristic → default to customs (product name)
  const wordCount = message.trim().split(/\s+/).length;
  if (wordCount <= thresholds.shortMessageMaxWords) {
    return {
      intent: config.defaultShortMessageAgent || 'customs',
      confidence: thresholds.shortMessageConfidence,
      method: 'short_message',
    };
  }

  // LLM classification
  const historyHint = history?.length > 0
    ? `\nContext: cuộc hội thoại trước đó về ${history[history.length - 1]?.content?.substring(0, 100)}`
    : '';

  const prompt = `${CLASSIFY_PROMPT}
${historyHint}
Tin nhắn: "${message}"`;

  try {
    const raw = await callLLM(prompt, apiKey, { temperature: 0.1, maxTokens: 100, model: MODELS.FAST });
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleaned);

    const validIntents = Object.keys(keywords);
    if (!validIntents.includes(result.intent)) {
      return { intent: config.fallbackAgent, confidence: 0.5, method: 'llm_fallback' };
    }

    return {
      intent: result.intent,
      confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
      method: 'llm',
    };
  } catch {
    return { intent: config.fallbackAgent, confidence: 0.3, method: 'error_fallback' };
  }
}
