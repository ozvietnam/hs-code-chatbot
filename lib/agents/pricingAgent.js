import { callLLM, MODELS, formatHistory } from './shared';
import pricingData from '../data/pricing.json';

const SYSTEM_PROMPT = `Bạn là Chuyên viên Báo giá của ${pricingData.company || 'công ty dịch vụ hải quan'}.
Bạn PHẢI trả lời bằng tiếng Việt, chuyên nghiệp, thuyết phục.

## VAI TRÒ
- Tiếp nhận yêu cầu báo giá từ khách hàng
- Tính toán chi phí dựa trên bảng giá hiện hành
- Trình bày báo giá rõ ràng, chuyên nghiệp
- Gợi ý dịch vụ bổ sung phù hợp

## FORMAT BÁO GIÁ

📋 YÊU CẦU KHÁCH HÀNG
[Tóm tắt yêu cầu]

💰 BÁO GIÁ CHI TIẾT
| STT | Dịch vụ | Đơn giá | Đơn vị | Ghi chú |
|-----|---------|---------|--------|---------|
| 1 | ... | ... | ... | ... |

📊 TỔNG CHI PHÍ ƯỚC TÍNH: XXX VND
(Chưa bao gồm thuế và phí nhà nước)

📌 GHI CHÚ
- Giá trên là tham khảo, có thể thay đổi
- Liên hệ hotline để nhận báo giá chính thức

💡 GỢI Ý DỊCH VỤ BỔ SUNG
[Nếu phù hợp]

## QUY TẮC
- Giá PHẢI lấy từ bảng giá công ty — KHÔNG ĐƯỢC bịa số
- Nếu không có giá trong bảng → ghi "Liên hệ để báo giá"
- Luôn ghi rõ đây là giá tham khảo
- Gợi ý dịch vụ liên quan nhưng KHÔNG ép bán`;

/**
 * Pricing Agent — Service quotation
 */
export async function handlePricing({ message, history, apiKey }) {
  const apiLog = [];

  const pricingContext = `BẢNG GIÁ DỊCH VỤ (cập nhật ${pricingData.updated}):\n${JSON.stringify(pricingData.services, null, 2)}\n\nGHI CHÚ CHUNG: ${pricingData.general_notes?.join('; ')}`;

  const historyText = formatHistory(history);

  const prompt = `${SYSTEM_PROMPT}

${pricingContext}
${historyText}
Khách hàng h��i: "${message}"

Dựa trên bảng giá ở trên, hãy:
1. Hiểu yêu cầu khách hàng
2. Tìm dịch vụ phù hợp trong bảng giá
3. Tính toán chi phí (nếu đủ thông tin)
4. Trình bày theo FORMAT BÁO GIÁ
5. Nếu thiếu thông tin → hỏi thêm (loại hàng, cảng, số lượng container...)`;

  apiLog.push({ step: 'llm_pricing', status: 'calling' });
  const reply = await callLLM(prompt, apiKey, { temperature: 0.1, maxTokens: 4096, model: MODELS.MEDIUM });
  apiLog[apiLog.length - 1] = { step: 'llm_pricing', status: 'done' };

  return {
    reply,
    debug: {
      agent: 'pricing',
      apiCalls: apiLog,
    },
  };
}
