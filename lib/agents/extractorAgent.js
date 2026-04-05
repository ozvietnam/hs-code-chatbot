import { callLLM, MODELS } from './shared';

const EXTRACT_PROMPT = `Bạn là AI chuyên trích xuất tri thức từ hội thoại tư vấn hải quan.
Phân tích đoạn hội thoại sau và trích xuất các BÀI HỌC có giá trị tái sử dụng.

Trả lời ĐÚNG JSON, không text khác:
{
  "insights": [
    {
      "type": "hs_insight|confusion|precedent|pricing|regulation",
      "content": "Mô tả bài học (1-3 câu, rõ ràng, actionable)",
      "hs_codes": ["mã HS liên quan nếu có"],
      "confidence": 0.0-1.0
    }
  ]
}

LOẠI INSIGHT:
- **hs_insight**: "Sản phẩm X → mã Y vì lý do Z" (phân loại thành công)
- **confusion**: "Users hay nhầm mã A với B vì lý do C" (pattern nhầm lẫn)
- **precedent**: "TB-TCHQ số X áp dụng cho trường hợp Y" (tiền lệ)
- **pricing**: "Dịch vụ X cho mặt hàng Y thường tốn Z" (giá cả)
- **regulation**: "Quy định X thường được hỏi, cần giải thích rõ về Y" (pháp luật)

QUY TẮC:
- Chỉ trích xuất insight CÓ GIÁ TRỊ — bỏ qua chào hỏi, câu hỏi chung
- Mỗi insight phải ACTIONABLE — giúp trả lời tốt hơn lần sau
- Confidence > 0.8 nếu có data API xác nhận, < 0.6 nếu chỉ là suy luận
- Trả [] rỗng nếu hội thoại không có insight nào đáng lưu`;

/**
 * Extract knowledge insights from a conversation transcript
 * @param {Array} messages - [{role, content, agent}]
 * @param {string} apiKey
 * @returns {Array} insights
 */
export async function extractInsights(messages, apiKey) {
  if (!messages || messages.length < 2) return [];

  // Build transcript
  const transcript = messages.map(m =>
    `[${m.agent || m.role}]: ${m.content.substring(0, 800)}`
  ).join('\n\n');

  const prompt = `${EXTRACT_PROMPT}

HỘI THOẠI:
${transcript}`;

  try {
    const raw = await callLLM(prompt, apiKey, { temperature: 0.1, maxTokens: 2048, model: MODELS.FAST });
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed.insights || [];
  } catch {
    return [];
  }
}
