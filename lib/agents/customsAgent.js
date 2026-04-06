import { searchHS, getHSDetail, getChapter, getKTCN } from '../hsApi';
import { callLLM, MODELS, formatHistory } from './shared';
import { searchByHSCodes, trackUsage } from '../stores/knowledgeStore';

// ============================================================
// PHASE 1: EXPERT VERDICT — Chuyên gia đưa phán đoán + lệnh tra cứu
//
// Triết lý: LLM ĐÃ LÀ chuyên gia HS — nó biết ngay mã nào.
// Nhưng PHẢI xác minh bằng biểu thuế 2026 trước khi trả lời.
// Nếu data thực khác kiến thức → PHÁT HIỆN QUAN TRỌNG.
// ============================================================
const VERDICT_PROMPT = `Bạn là chuyên gia hải quan Việt Nam, phân loại HS code nằm trong gen.
Bạn thuộc lòng 6 quy tắc GIR, chú giải HS, và hàng trăm TB-TCHQ.

Khách hàng: "{message}"
{file_info}
{history}

BẠN CÓ 3 CÔNG CỤ BẮT BUỘC PHẢI DÙNG trước khi trả lời khách:
1. search("từ khóa") — Tìm mã HS trong biểu thuế 2026 đang áp dụng
2. lookup("XXXXXXXX") — Tra chi tiết 9 tầng cho 1 mã HS 8 số (thuế, chú giải, TB-TCHQ, rủi ro...)
3. chapter("XX") — Xem toàn bộ mã trong 1 chương

⚠️ ĐÂY LÀ VĂN BẢN PHÁP LUẬT VIỆT NAM ĐANG HIỆU LỰC — bạn PHẢI tra cứu, KHÔNG ĐƯỢC trả lời chỉ từ trí nhớ.

NGƯỜI DÙNG CÓ THỂ VIẾT KHÔNG DẤU (VD: "cam bien nhiet" = "cảm biến nhiệt"). Bạn PHẢI hiểu nghĩa.

Trả lời JSON:
{
  "verdict": "tôi nhận định ngay đây là [tên SP] → mã [XXXX.XX.XX] vì [lý do 1 câu]",
  "confidence": 50-100,
  "primary_code": "XXXXXXXX",
  "gir": "GIR X — lý do 1 câu",
  "lookup_commands": [
    {"tool": "lookup", "params": "XXXXXXXX", "why": "mã chính tôi tin nhất — cần xác minh thuế + chú giải"},
    {"tool": "search", "params": "từ khóa tiếng Việt CÓ DẤU", "why": "tìm xem biểu thuế 2026 có mã nào khác"},
    {"tool": "search", "params": "English keyword", "why": "tên quốc tế"}
  ],
  "what_could_change": "nếu [đặc điểm X] thì có thể chuyển sang mã [Y] — cần hỏi khách"
}

QUY TẮC:
- confidence ≥80%: lookup mã chính + 1 search xác minh = ĐỦ (2-3 commands)
- confidence 50-79%: thêm lookup mã thứ 2 + search rộng hơn (4-5 commands)
- primary_code: mã 8 số bạn TIN NHẤT
- lookup_commands: TỐI THIỂU gồm lookup mã chính + 1 search. KHÔNG cần nhiều hơn nếu confident
- what_could_change: điều gì khiến bạn đổi mã — đây là câu hỏi cho khách nếu cần`;

// ============================================================
// PHASE 2: RESPOND — Trả lời dựa trên data thực + phát hiện sai khác
// ============================================================
const RESPOND_PROMPT = `Bạn là chuyên gia hải quan Việt Nam. Bạn vừa tra cứu biểu thuế 2026 đang hiệu lực.

KHÁCH HÀNG: "{message}"
{file_info}
{history}

PHÁN ĐOÁN BAN ĐẦU CỦA BẠN: {verdict}
CONFIDENCE: {confidence}%

DỮ LIỆU THỰC TỪ BIỂU THUẾ 2026 (9 tầng):
{data}

{knowledge_base}

─────────────────────────────
NGUYÊN TẮC TRẢ LỜI:

1. SO SÁNH phán đoán vs data thực:
   - Khớp → tự tin trả lời
   - KHÔNG KHỚP → ĐÂY LÀ PHÁT HIỆN QUAN TRỌNG, phải nêu rõ: "⚡ Lưu ý: theo biểu thuế 2026, mã này đã thay đổi/khác so với phiên bản cũ..."

2. CÁCH TRẢ LỜI theo confidence:

   ▸ Confidence CAO (≥80%) — Trả lời NGẮN GỌN:
   🎯 [MÃ HS] — [Tên sản phẩm]
   Thuế: MFN X% | ACFTA X% | VAT X%
   📌 Căn cứ: [chú giải/SEN/TB-TCHQ — trích ngắn gọn, có nguồn]

   ▸ Confidence TRUNG BÌNH (50-79%) — So sánh 2-3 mã:
   🔍 Sản phẩm "[tên]" có thể thuộc:
   1. **XXXX.XX.XX** — [mô tả] → nếu [điều kiện]
   2. **YYYY.YY.YY** — [mô tả] → nếu [điều kiện]
   ❓ Để phân loại chính xác: [1 câu hỏi cụ thể]

3. LUÔN KẾT THÚC bằng gợi ý follow-up (chọn phù hợp):
   💡 Bạn có thể hỏi thêm:
   → "Xem chú giải chi tiết" — trích chú giải chương/nhóm + SEN AHTN 2022
   → "TB-TCHQ liên quan" — thông báo phân loại của Tổng cục HQ
   → "Mã dễ nhầm" — rủi ro phân loại + lịch sử tranh chấp
   → "Mô tả khai ECUS" — gợi ý mô tả khai báo hải quan
   → "Kiểm tra chuyên ngành" — giấy phép, kiểm dịch cần thiết
   → "Soạn công văn giải trình" — bản giải trình áp mã HS
   → "So sánh thuế FTA" — thuế suất các hiệp định
   (Chỉ gợi ý 3-5 mục PHÙ HỢP nhất với câu hỏi, KHÔNG liệt kê tất cả)

4. QUY TẮC BẤT DI BẤT DỊCH:
   - Thuế suất CHỈ từ fact_layer. Không có → "Chưa có dữ liệu thuế trong hệ thống"
   - Trích dẫn PHẢI có nguồn: "Chú giải chương XX", "SEN mục (X)", "TB-TCHQ số XXXX"
   - KHÔNG dump thông tin thừa — chỉ trả lời đúng cái khách cần ở bước này
   - Mặc định xuất xứ TQ → ACFTA
   - Viết tiếng Việt, thân thiện, chuyên nghiệp
─────────────────────────────`;

// ============================================================
// FOLLOW-UP: Xử lý khi user chọn xem thêm
// ============================================================
// Strip Vietnamese diacritics for robust pattern matching
// Handles both NFC and NFD input forms
function removeDiacritics(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '')
    .replace(/[đ\u0111]/g, 'd')
    .replace(/[Đ\u0110]/g, 'D');
}

// Follow-up patterns use ASCII (diacritics-stripped) for reliable matching
const FOLLOWUP_PATTERNS = {
  chu_giai: /chu giai|sen|legal|annotation/i,
  tb_tchq: /tb[- ]?tchq|thong bao|precedent|tien le/i,
  rui_ro: /rui ro|de nham|conflict|tranh chap/i,
  ecus: /ecus|mo ta khai|khai bao/i,
  kiem_tra: /kiem tra|chuyen nganh|giay phep|kiem dich/i,
  cong_van: /cong van|giai trinh|ap ma/i,
  thue_fta: /thue.*fta|so sanh thue|acfta|atiga|evfta|cptpp/i,
};

// ============================================================
// HELPERS
// ============================================================
function parseSearchResults(searchData) {
  const sources = { bieu_thue: [], tb_tchq: [], bao_gom: [], conflict: [] };
  const all = [];
  if (!searchData?.results) return { sources, all };
  for (const [source, data] of Object.entries(searchData.results)) {
    if (!sources[source]) sources[source] = [];
    const items = data?.items || (Array.isArray(data) ? data : []);
    if (items.length > 0) {
      sources[source].push(...items);
      all.push(...items.map(i => ({ ...i, _source: source })));
    }
  }
  return { sources, all };
}

function dedup(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = r.hs || r.ma_hs || r.hs_code || r.so_hieu || JSON.stringify(r).substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// EXECUTE LOOKUPS — chạy lệnh tra cứu từ chuyên gia
// ============================================================
async function executeLookups(commands, apiLog) {
  const searchSources = { bieu_thue: [], tb_tchq: [], bao_gom: [], conflict: [] };
  let allResults = [];
  let hsDetails = [];

  const results = await Promise.allSettled(
    (commands || []).slice(0, 6).map(async (cmd) => {
      const { tool, params, why } = cmd;
      apiLog.push({ step: `${tool}`, params, why, status: 'calling' });

      try {
        if (tool === 'search') {
          const data = await searchHS(params, 10);
          const parsed = parseSearchResults(data);
          apiLog.push({ step: `${tool}`, params, status: 'done', count: parsed.all.length });
          return { type: 'search', parsed };
        }
        if (tool === 'lookup') {
          const detail = await getHSDetail(params);
          if (detail?.found !== false) {
            apiLog.push({ step: `${tool}`, params, status: 'done' });
            return { type: 'lookup', detail: { code: params, ...detail } };
          }
          // Not found → try chapter expansion
          const ch2 = params.substring(0, 2);
          const ch4 = params.substring(0, 4);
          apiLog.push({ step: `${tool}`, params, status: 'expanding', chapter: ch4 });
          try {
            const chData = await getChapter(ch2);
            const items = (chData?.items || chData?.results || []);
            const matching = items.filter(i => (i.hs || i.ma_hs || i.hs_code || '').startsWith(ch4)).slice(0, 4);
            if (matching.length > 0) {
              const expanded = await Promise.allSettled(
                matching.slice(0, 3).map(async (item) => {
                  const code = item.hs || item.ma_hs || item.hs_code;
                  const d = await getHSDetail(code);
                  return d?.found !== false ? { code, ...d } : null;
                })
              );
              const details = expanded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
              apiLog.push({ step: `${tool}`, params, status: 'expanded', found: details.length });
              return { type: 'lookup_expanded', details };
            }
          } catch { /* skip */ }
          return null;
        }
        if (tool === 'chapter') {
          const chData = await getChapter(params);
          const items = (chData?.items || chData?.results || []).slice(0, 20);
          apiLog.push({ step: `${tool}`, params, status: 'done', count: items.length });
          return { type: 'chapter', items: items.map(i => ({ ...i, _source: `chapter_${params}` })) };
        }
        return null;
      } catch (e) {
        apiLog.push({ step: `${tool}`, params, status: 'error', error: e.message });
        return null;
      }
    })
  );

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const v = r.value;
    if (v.type === 'search') {
      for (const [key, items] of Object.entries(v.parsed.sources)) {
        if (!searchSources[key]) searchSources[key] = [];
        searchSources[key].push(...items);
      }
      allResults.push(...v.parsed.all);
    } else if (v.type === 'lookup') {
      hsDetails.push(v.detail);
      allResults.push({ hs: v.detail.code, _source: 'lookup', vn: v.detail.fact_layer?.vn || v.detail.code });
    } else if (v.type === 'lookup_expanded') {
      for (const d of v.details) {
        hsDetails.push(d);
        allResults.push({ hs: d.code, _source: 'expanded', vn: d.fact_layer?.vn || d.code });
      }
    } else if (v.type === 'chapter') {
      allResults.push(...v.items);
    }
  }

  return { searchSources, allResults: dedup(allResults), hsDetails };
}

// ============================================================
// BUILD DATA CONTEXT — compact nhưng đủ cho chuyên gia
// ============================================================
function buildDataContext(searchSources, allResults, hsDetails) {
  const parts = [];

  if (hsDetails.length > 0) {
    const details = hsDetails.slice(0, 3).map(d => {
      const detail = { code: d.code };
      if (d.fact_layer) {
        detail.tax = {
          vn: (d.fact_layer.vn || '').substring(0, 120),
          mfn: d.fact_layer.mfn, acfta: d.fact_layer.acfta, atiga: d.fact_layer.atiga,
          vat: d.fact_layer.vat, bvmt: d.fact_layer.bvmt, ttdb: d.fact_layer.ttdb,
        };
        if (d.fact_layer.chinh_sach) detail.tax.cs = d.fact_layer.chinh_sach;
        if (d.fact_layer.canh_bao) detail.tax.cb = d.fact_layer.canh_bao;
      }
      if (d.legal_layer) {
        detail.legal = {};
        if (d.legal_layer.chu_giai_chuong) detail.legal.chuong = typeof d.legal_layer.chu_giai_chuong === 'string' ? d.legal_layer.chu_giai_chuong.substring(0, 500) : d.legal_layer.chu_giai_chuong;
        if (d.legal_layer.chu_giai_nhom) detail.legal.nhom = typeof d.legal_layer.chu_giai_nhom === 'string' ? d.legal_layer.chu_giai_nhom.substring(0, 300) : d.legal_layer.chu_giai_nhom;
        if (d.legal_layer.bao_gom) detail.legal.bg = d.legal_layer.bao_gom;
        if (d.legal_layer.khong_bao_gom) detail.legal.kbg = d.legal_layer.khong_bao_gom;
        if (d.legal_layer.loai_tru) detail.legal.lt = d.legal_layer.loai_tru;
        if (d.legal_layer.sen) detail.legal.sen = d.legal_layer.sen;
        if (d.legal_layer.tinh_chat) detail.legal.tc = d.legal_layer.tinh_chat;
      }
      if (d.regulatory_layer) detail.reg = d.regulatory_layer;
      if (d.precedent_layer?.tb_tchq?.length) detail.tb = d.precedent_layer.tb_tchq.slice(0, 3).map(t => ({
        tb: t.so_hieu, sp: (t.ten_san_pham || '').substring(0, 60), hs: t.ma_hs,
        ly_do: (t.ly_do_phan_loai || '').substring(0, 100),
      }));
      if (d.conflict_layer) detail.conflict = d.conflict_layer;
      if (d.classification_layer) detail.gir = d.classification_layer;
      if (d.cross_border_layer) detail.wco = d.cross_border_layer;
      if (d.logistics_layer) detail.logistics = d.logistics_layer;
      return detail;
    });
    parts.push(`CHI TIẾT 9 TẦNG:${JSON.stringify(details)}`);
  }

  if (searchSources.tb_tchq.length > 0) {
    const tb = searchSources.tb_tchq.slice(0, 4).map(t => ({
      tb: t.so_hieu, sp: (t.ten_san_pham || '').substring(0, 80), hs: t.ma_hs,
      ly_do: (t.ly_do_phan_loai || '').substring(0, 150),
    }));
    parts.push(`TB-TCHQ:${JSON.stringify(tb)}`);
  }

  if (searchSources.conflict.length > 0) {
    const conflict = searchSources.conflict.slice(0, 3).map(c => ({
      hs: c.hs || c.ma_hs, product: c.product, risk: c.muc_rui_ro, reason: c.reason,
    }));
    parts.push(`XUNG ĐỘT:${JSON.stringify(conflict)}`);
  }

  if (allResults.length > 0 && hsDetails.length === 0) {
    // No details loaded — show search results
    const trimmed = allResults.slice(0, 8).map(r => ({
      hs: r.hs || r.ma_hs || r.hs_code,
      vn: (r.vn || r.ten_vn || r.mo_ta || '').substring(0, 80),
    }));
    parts.push(`TÌM KIẾM:${JSON.stringify(trimmed)}`);
  }

  return parts.join('\n\n');
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
export async function handleCustoms({ message, history, file, apiKey }) {
  const apiLog = [];
  const fileInfo = file ? `[File: ${file.name} (${file.mimeType})]` : '';
  const historyText = formatHistory(history);

  // Check if this is a follow-up request (user asking for more detail)
  const isFollowUp = detectFollowUp(message, history);

  // ═══════════════════════════════════════════════════════
  // KTCN HANDLER — Kiểm tra chuyên ngành (follow-up shortcut)
  // ═══════════════════════════════════════════════════════
  if (isFollowUp === 'kiem_tra') {
    const ktcnResult = await handleKTCNFollowUp(message, history, apiKey);
    if (ktcnResult) return ktcnResult;
  }

  // ═══════════════════════════════════════════════════════
  // PHASE 1: VERDICT — Chuyên gia phán đoán + lệnh tra cứu
  // ═══════════════════════════════════════════════════════
  apiLog.push({ step: 'verdict', status: 'calling' });

  let verdict;
  try {
    const prompt = VERDICT_PROMPT
      .replace('{message}', message || '(xem file đính kèm)')
      .replace('{file_info}', fileInfo ? `\n${fileInfo}` : '')
      .replace('{history}', historyText ? `\nHỘI THOẠI TRƯỚC:${historyText}` : '');

    const raw = await callLLM(prompt, apiKey, {
      file, model: MODELS.FAST, temperature: 0.2, maxTokens: 1500,
    });

    let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (!cleaned.startsWith('{')) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
    }
    verdict = JSON.parse(cleaned);
    apiLog.push({
      step: 'verdict', status: 'done',
      confidence: verdict.confidence,
      primary: verdict.primary_code,
      commands: verdict.lookup_commands?.length || 0,
    });
  } catch (err) {
    apiLog.push({ step: 'verdict', status: 'error', error: err.message });
    // Fallback: simple search
    const text = (message || '').trim();
    verdict = {
      verdict: text,
      confidence: 40,
      primary_code: '',
      gir: 'GIR 1',
      lookup_commands: [
        { tool: 'search', params: text, why: 'tìm trực tiếp' },
        ...(text.split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => (
          { tool: 'search', params: w, why: 'từ khóa đơn' }
        ))),
      ],
      what_could_change: '',
    };
  }

  // ═══════════════════════════════════════════════════════
  // PHASE 2: LOOKUP — Tra cứu data thực (bắt buộc)
  // ═══════════════════════════════════════════════════════
  apiLog.push({ step: 'lookup', status: 'calling' });

  let { searchSources, allResults, hsDetails } = await executeLookups(verdict.lookup_commands, apiLog);

  // Fallback: nếu 0 kết quả, split message thành từ khóa ngắn
  if (allResults.length === 0 && hsDetails.length === 0) {
    apiLog.push({ step: 'fallback_search', status: 'calling' });
    const words = (message || '').trim().split(/\s+/).filter(w => w.length > 1);
    const shortTerms = [];
    for (let i = 0; i < words.length - 1; i++) shortTerms.push(words.slice(i, i + 2).join(' '));
    words.filter(w => w.length > 2).forEach(w => shortTerms.add ? shortTerms.push(w) : shortTerms.push(w));

    const fallback = await Promise.allSettled(
      [...new Set(shortTerms)].slice(0, 5).map(async (term) => {
        try {
          const data = await searchHS(term, 10);
          return parseSearchResults(data);
        } catch { return null; }
      })
    );
    for (const r of fallback) {
      if (r.status === 'fulfilled' && r.value) {
        for (const [key, items] of Object.entries(r.value.sources)) {
          if (!searchSources[key]) searchSources[key] = [];
          searchSources[key].push(...items);
        }
        allResults.push(...r.value.all);
      }
    }
    allResults = dedup(allResults);

    // Fetch details for top results
    if (allResults.length > 0 && hsDetails.length === 0) {
      const topCodes = allResults.slice(0, 3).map(r => r.hs || r.ma_hs || r.hs_code).filter(Boolean);
      const detailResults = await Promise.allSettled(
        topCodes.map(async (code) => {
          const d = await getHSDetail(code);
          return d?.found !== false ? { code, ...d } : null;
        })
      );
      hsDetails = detailResults.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    }
    apiLog.push({ step: 'fallback_search', status: 'done', results: allResults.length, details: hsDetails.length });
  }

  const hasData = allResults.length > 0 || hsDetails.length > 0;
  apiLog.push({ step: 'lookup', status: 'done', results: allResults.length, details: hsDetails.length });

  // Query Knowledge Base
  let knowledgeItems = [];
  const allCodes = [...new Set(allResults.map(r => r.hs || r.ma_hs || r.hs_code).filter(Boolean))];
  if (allCodes.length > 0) {
    try {
      knowledgeItems = await searchByHSCodes(allCodes, 5);
      if (knowledgeItems.length > 0) {
        apiLog.push({ step: 'kb', status: 'done', items: knowledgeItems.length });
        trackUsage(knowledgeItems.map(i => i.id)).catch(() => {});
      }
    } catch { /* skip */ }
  }

  // ═══════════════════════════════════════════════════════
  // PHASE 3: RESPOND — Trả lời khách hàng
  // ═══════════════════════════════════════════════════════
  const dataContext = buildDataContext(searchSources, allResults, hsDetails);

  const kbSection = knowledgeItems.length > 0
    ? `\nKIẾN THỨC TỪ HỘI THOẠI TRƯỚC:\n${knowledgeItems.map(i => `[${i.type}] ${i.content}`).join('\n')}`
    : '';

  let responsePrompt;
  if (hasData) {
    responsePrompt = RESPOND_PROMPT
      .replace('{message}', message || '(xem file)')
      .replace('{file_info}', fileInfo)
      .replace('{history}', historyText)
      .replace('{verdict}', verdict.verdict || message)
      .replace('{confidence}', String(verdict.confidence || 50))
      .replace('{data}', dataContext)
      .replace('{knowledge_base}', kbSection);
  } else {
    responsePrompt = `Bạn là chuyên gia hải quan Việt Nam.

KHÁCH HÀNG: "${message || '(xem file)'}"
${fileInfo}
${historyText}

PHÁN ĐOÁN BAN ĐẦU: ${verdict.verdict || message}
CONFIDENCE: ${verdict.confidence || 50}%
${verdict.what_could_change ? `CẦN LÀM RÕ: ${verdict.what_could_change}` : ''}

Đã tra cứu biểu thuế 2026 nhưng KHÔNG tìm thấy kết quả trực tiếp cho sản phẩm này.

CÁCH TRẢ LỜI (DÙNG ĐÚNG FORMAT NÀY):

▸ Nếu confidence ≥80%:
🎯 **[MÃ HS dự kiến]** — [Tên sản phẩm]
Thuế: Chưa có dữ liệu thuế trong hệ thống — cần tra cứu thêm
📌 Căn cứ: [dùng kiến thức chuyên gia — chú giải, GIR, TB-TCHQ nếu biết]
⚡ Lưu ý: biểu thuế 2026 chưa có mục phù hợp chính xác — cần xác minh thêm

▸ Nếu confidence <80%:
🔍 Sản phẩm "[tên]" có thể thuộc:
1. **XXXX.XX.XX** — [mô tả] → nếu [điều kiện]
2. **YYYY.YY.YY** — [mô tả] → nếu [điều kiện]
❓ Để phân loại chính xác: [câu hỏi cụ thể]

LUÔN kết thúc:
💡 Bạn có thể hỏi thêm:
*   **Xem chú giải chi tiết** — phạm vi và loại trừ
*   **TB-TCHQ liên quan** — tiền lệ phân loại
*   **Mô tả khai ECUS** — gợi ý khai báo

Trả lời tiếng Việt, ngắn gọn, chuyên nghiệp.`;
  }

  apiLog.push({ step: 'respond', status: 'calling' });
  let reply;
  try {
    reply = await callLLM(responsePrompt, apiKey, {
      file, model: MODELS.HEAVY, maxTokens: 4000,
    });
    apiLog.push({ step: 'respond', status: 'done', length: reply.length });
  } catch (err) {
    apiLog.push({ step: 'respond', status: 'error', error: err.message });
    if (hasData && hsDetails.length > 0) {
      const d = hsDetails[0];
      const tax = d.fact_layer;
      reply = `🎯 **${d.code}** — ${tax?.vn || 'N/A'}\nThuế: MFN ${tax?.mfn || '?'}% | ACFTA ${tax?.acfta || '?'}% | VAT ${tax?.vat || '?'}%\n\n💡 Hỏi thêm: "Xem chú giải chi tiết", "TB-TCHQ liên quan"`;
    } else {
      reply = `Đã tra cứu "${message}" nhưng chưa tìm được kết quả. Vui lòng mô tả chi tiết hơn (vật liệu, chức năng, công dụng).`;
    }
  }

  return {
    reply,
    debug: {
      agent: 'customs',
      architecture: 'reasoning_v3_adaptive',
      verdict: {
        confidence: verdict.confidence,
        primary_code: verdict.primary_code,
        gir: verdict.gir,
        what_could_change: verdict.what_could_change,
        commands: (verdict.lookup_commands || []).length,
      },
      lookup: {
        searchResults: allResults.length,
        hsDetails: hsDetails.length,
        tb_tchq: searchSources.tb_tchq.length,
        sources: {
          bieu_thue: searchSources.bieu_thue.length,
          tb_tchq: searchSources.tb_tchq.length,
          bao_gom: searchSources.bao_gom.length,
          conflict: searchSources.conflict.length,
        },
      },
      hasData,
      knowledgeItems: knowledgeItems.length,
      file: file ? { name: file.name, mimeType: file.mimeType } : null,
      apiCalls: apiLog,
    },
  };
}

// ============================================================
// KTCN FOLLOW-UP HANDLER — trả KTCN từ data thực, không hallucinate
// ============================================================
async function handleKTCNFollowUp(message, history, apiKey) {
  // Extract HS code from conversation history
  const hsCode = extractHSCodeFromHistory(history);
  if (!hsCode) return null;

  const ktcnData = await getKTCN(hsCode);
  if (!ktcnData || !ktcnData.found) return null;

  const reply = formatKTCNResponse(hsCode, ktcnData);

  return {
    reply,
    debug: {
      agent: 'customs',
      architecture: 'ktcn_followup',
      hs_code: hsCode,
      ktcn_found: true,
      co_quan: ktcnData.co_quan || [],
    },
  };
}

function extractHSCodeFromHistory(history) {
  if (!history?.length) return null;
  // Search assistant messages backwards for HS code pattern
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;
    const content = msg.content || '';
    // Match patterns like "8516.71.00", "85167100", "**85167100**"
    const match = content.match(/\b(\d{4})[.\s]?(\d{2})[.\s]?(\d{2})\b/);
    if (match) return match[1] + match[2] + match[3];
  }
  return null;
}

function formatKTCNResponse(hsCode, data) {
  const parts = [];
  const formattedHS = `${hsCode.slice(0,4)}.${hsCode.slice(4,6)}.${hsCode.slice(6,8)}`;

  parts.push(`🔍 **KIỂM TRA CHUYÊN NGÀNH** cho mã **${formattedHS}** — ${data.ten || ''}`);

  if (data.muc_canh_bao) {
    const icons = { RED: '🔴', ORANGE: '🟠', YELLOW: '🟡' };
    parts.push(`${icons[data.muc_canh_bao] || '⚪'} Mức cảnh báo: **${data.muc_canh_bao}**`);
  }

  // Group KTCN entries by co_quan
  const byCoQuan = {};
  const ktcnList = data.ktcn_chi_tiet || data.ktcn || [];
  for (const k of ktcnList) {
    const cq = k.co_quan || 'Khác';
    if (!byCoQuan[cq]) byCoQuan[cq] = [];
    byCoQuan[cq].push(k);
  }

  // Section: Cơ quan quản lý
  parts.push('\n📋 **CƠ QUAN QUẢN LÝ:**');
  let idx = 1;
  for (const [cq, entries] of Object.entries(byCoQuan)) {
    const types = [...new Set(entries.map(e => e.loai_ten || e.mo_ta || e.loai || '').filter(Boolean))];
    const donVi = entries[0]?.don_vi || '';
    parts.push(`${idx}. **${cq}**${donVi ? ` (${donVi})` : ''} — ${types.join(', ')}`);
    idx++;
  }

  // Section: Căn cứ pháp lý (from ktcn_chi_tiet)
  const allVanBan = [];
  const seenVB = new Set();
  for (const k of ktcnList) {
    // Direct van_ban from the entry
    if (k.van_ban && !seenVB.has(k.van_ban)) {
      seenVB.add(k.van_ban);
      allVanBan.push({
        tier: k.tier || 4,
        so_hieu: k.van_ban,
        danh_muc: k.danh_muc,
        mo_ta: k.mo_ta || '',
      });
    }
    // Full legal chain from reference
    if (k.van_ban_phap_ly) {
      for (const vb of k.van_ban_phap_ly) {
        if (!seenVB.has(vb.so_hieu)) {
          seenVB.add(vb.so_hieu);
          allVanBan.push(vb);
        }
      }
    }
  }

  if (allVanBan.length > 0) {
    allVanBan.sort((a, b) => (a.tier || 9) - (b.tier || 9));
    const tierNames = { 1: 'Luật', 2: 'NĐ', 3: 'TT', 4: 'QĐ/CV', 5: 'Hiệp định' };
    parts.push('\n📜 **CĂN CỨ PHÁP LÝ:**');
    parts.push('| Tầng | Văn bản | Nội dung |');
    parts.push('|------|---------|----------|');
    for (const vb of allVanBan.slice(0, 12)) {
      const tier = tierNames[vb.tier] || `T${vb.tier}`;
      const dm = vb.danh_muc ? ` (${vb.danh_muc})` : '';
      const ten = vb.ten || vb.mo_ta || '';
      parts.push(`| ${tier} | ${vb.so_hieu}${dm} | ${ten} |`);
    }
  }

  // Section: Thủ tục (from first entry with thu_tuc)
  const entryWithThuTuc = ktcnList.find(k => k.thu_tuc?.buoc?.length > 0);
  if (entryWithThuTuc) {
    const tt = entryWithThuTuc.thu_tuc;
    parts.push(`\n📝 **THỦ TỤC** (${entryWithThuTuc.loai_ten || entryWithThuTuc.loai || ''}):`);
    tt.buoc.forEach((b, i) => parts.push(`${i + 1}. ${b}`));
    if (tt.thoi_gian) parts.push(`\n⏱ **Thời gian:** ${tt.thoi_gian}`);
    if (tt.noi_nop) parts.push(`📍 **Nơi nộp:** ${tt.noi_nop}`);
    if (tt.ho_so?.length > 0) {
      parts.push(`\n📎 **Hồ sơ cần thiết:**`);
      tt.ho_so.forEach(h => parts.push(`- ${h}`));
    }
  }

  // Section: Lưu ý
  const allLuuY = [];
  for (const k of ktcnList) {
    if (k.luu_y) allLuuY.push(...k.luu_y);
  }
  if (allLuuY.length > 0) {
    parts.push(`\n⚠️ **LƯU Ý:**`);
    [...new Set(allLuuY)].forEach(ly => parts.push(`- ${ly}`));
  }

  // Follow-up suggestions
  parts.push(`\n💡 **Bạn có thể hỏi thêm:**`);
  parts.push(`*   **Xem chú giải chi tiết** — phạm vi phân loại`);
  parts.push(`*   **TB-TCHQ liên quan** — tiền lệ phân loại`);
  parts.push(`*   **So sánh thuế FTA** — ACFTA/ATIGA/CPTPP/EVFTA`);

  return parts.join('\n');
}

// ============================================================
// DETECT FOLLOW-UP — nhận diện user muốn xem thêm
// ============================================================
function detectFollowUp(message, history) {
  if (!history?.length || !message) return null;
  const normalized = removeDiacritics(message.toLowerCase());
  for (const [type, pattern] of Object.entries(FOLLOWUP_PATTERNS)) {
    if (pattern.test(normalized)) return type;
  }
  return null;
}
