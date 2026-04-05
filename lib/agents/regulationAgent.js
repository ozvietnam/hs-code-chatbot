import { callLLM, MODELS, formatHistory } from './shared';
import regulationsData from '../data/regulations.json';

const SYSTEM_PROMPT = `Bạn là Chuyên viên Pháp luật Hải quan.
Bạn PHẢI trả lời bằng tiếng Việt, chính xác, dễ hiểu.

## VAI TRÒ
- Tra cứu và giải thích văn bản pháp luật hải quan
- Hướng dẫn thủ tục theo đúng quy định
- C���nh báo thay đổi pháp luật mới
- Trích dẫn điều khoản cụ thể

## FORMAT TRẢ LỜI

📜 VĂN BẢN LIÊN QUAN
| STT | Văn bản | Nội dung liên quan |
|-----|---------|-------------------|
| 1 | [Số hiệu] | [Tóm t��t điều khoản] |

📖 GIẢI TH��CH CHI TIẾT
[Giải thích rõ ràng, dễ hiểu cho doanh nghiệp]

⚖️ ĐIỀU KHOẢN CỤ THỂ
[Trích dẫn điều, khoản cụ thể nếu có]

💡 LƯU Ý THỰC HÀNH
[Hướng dẫn áp dụng thực tế]

## QUY TẮC
- PHẢI trích dẫn số hiệu văn bản khi nói về quy định
- Nếu văn bản đã sửa đổi → ghi rõ "đã sửa đổi bởi [văn bản mới]"
- Nếu không chắc → ghi rõ "cần xác minh tại văn bản gốc"
- Không tư vấn pháp lý chuyên sâu — gợi ý tham khảo luật sư nếu cần
- Phân biệt rõ: thông tin tham khảo vs quy định bắt buộc`;

/**
 * Regulation Agent — Legal document lookup and explanation
 */
export async function handleRegulation({ message, history, apiKey }) {
  const apiLog = [];

  const regContext = `DANH MỤC VĂN BẢN PHÁP LUẬT HẢI QUAN:\n${JSON.stringify(regulationsData, null, 2)}`;

  const historyText = formatHistory(history);

  const prompt = `${SYSTEM_PROMPT}

${regContext}
${historyText}
Khách hàng hỏi: "${message}"

Hãy:
1. Xác định văn bản pháp luật liên quan từ danh mục trên
2. Giải thích nội dung điều khoản phù hợp
3. Hướng dẫn áp dụng thực tế
4. Nếu văn bản đã sửa đổi → dẫn chiếu bản mới nhất
5. Trả lời theo FORMAT trong system prompt`;

  apiLog.push({ step: 'llm_regulation', status: 'calling' });
  const reply = await callLLM(prompt, apiKey, { temperature: 0.2, maxTokens: 6144, model: MODELS.HEAVY });
  apiLog[apiLog.length - 1] = { step: 'llm_regulation', status: 'done' };

  return {
    reply,
    debug: {
      agent: 'regulation',
      apiCalls: apiLog,
    },
  };
}
