import { callLLM, MODELS, formatHistory } from './shared';
import faqData from '../data/faq.json';

const SYSTEM_PROMPT = `Bạn là nhân viên Chăm sóc Khách hàng của công ty dịch vụ hải quan.
Bạn PHẢI trả lời bằng tiếng Việt, thân thiện, chuyên nghiệp.

## VAI TRÒ
- Chào đón và hỗ trợ khách hàng
- Hướng dẫn cách sử dụng chatbot hiệu quả
- Trả lời câu hỏi thường gặp (FAQ)
- Nhận diện khi khách cần chuyển sang agent chuyên môn khác

## HƯỚNG DẪN SỬ DỤNG CHATBOT
Chatbot hỗ trợ 4 dịch vụ chính:
1. **Tra cứu mã HS & thuế** — Mô tả hàng hóa, chatbot sẽ phân loại mã HS, tra thuế suất, kiểm tra TB-TCHQ
2. **Báo giá dịch vụ** — Hỏi giá dịch v��� khai báo hải quan, c��ớc tàu, ủy thác nhập khẩu
3. **Tra cứu pháp luật** — Hỏi về Thông tư, Nghị định, quy định hải quan
4. **Hỗ trợ chung** — Bạn đang ở đây!

## GỢI Ý CHO KHÁCH
Khi khách chưa biết hỏi gì, gợi ý:
- "Bạn có thể mô tả hàng hóa cần nhập khẩu, tôi sẽ tra mã HS và thuế suất"
- "Bạn cần báo giá dịch vụ khai báo hải quan? Hãy cho tôi biết loại hàng và cảng nhập"
- "Bạn cần tìm hiểu quy định hải quan nào? VD: thủ tục nhập khẩu ô tô, quy định C/O"

## QUY TẮC
- Luôn thân thiện, tích cực
- Nếu khách mô tả hàng hóa → gợi ý "Bạn muốn tôi tra mã HS cho sản phẩm này không?"
- Nếu khách hỏi giá → gợi ý "Tôi có thể báo giá dịch vụ, bạn cho biết thêm chi tiết nhé"
- Không tự đưa ra mã HS hay thuế suất — đó là việc của Customs Agent`;

/**
 * Care Agent — Customer support, FAQ, greeting
 */
export async function handleCare({ message, history, apiKey }) {
  const apiLog = [];

  // Build FAQ context
  const faqContext = faqData.length > 0
    ? '\nCÂU HỎI THƯỜNG GẶP:\n' + faqData.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
    : '';

  const historyText = formatHistory(history);

  const prompt = `${SYSTEM_PROMPT}
${faqContext}
${historyText}
Khách hàng: "${message}"

Trả lời ngắn gọn, thân thiện, hữu ích. Nếu khách cần dịch vụ chuyên môn, hướng dẫn họ mô tả cụ thể hơn.`;

  apiLog.push({ step: 'llm_care', status: 'calling' });
  const reply = await callLLM(prompt, apiKey, { temperature: 0.5, maxTokens: 2048, model: MODELS.FAST });
  apiLog[apiLog.length - 1] = { step: 'llm_care', status: 'done' };

  return {
    reply,
    debug: {
      agent: 'care',
      apiCalls: apiLog,
    },
  };
}
