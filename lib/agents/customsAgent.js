import { searchHS, getHSDetail, getChapter } from '../hsApi';
import { callLLM, MODELS, formatHistory } from './shared';
import { searchByHSCodes, trackUsage } from '../stores/knowledgeStore';

// ============================================================
// PHASE 1: EXPERT THINK — Chuyên gia suy nghĩ trước khi hành động
// ============================================================
const THINK_PROMPT = `Bạn là chuyên gia hải quan 20 năm kinh nghiệm phân loại mã HS Việt Nam.
Bạn thuộc lòng biểu thuế 2026, 6 quy tắc GIR, chú giải HS 2022, và hàng trăm TB-TCHQ.

Khách hàng hỏi: "{message}"
{file_info}
{history}

BẠN CÓ CÁC CÔNG CỤ ĐIỀU TRA:
1. search("từ khóa") — Tìm mã HS trong biểu thuế 2026 theo từ khóa tiếng Việt/Anh
2. lookup("XXXXXXXX") — Tra chi tiết 9 tầng cho 1 mã HS 8 số (thuế, chú giải, TB-TCHQ, rủi ro...)
3. chapter("XX") — Xem toàn bộ mã trong 1 chương (2 số)

HÃY SUY NGHĨ NHƯ CHUYÊN GIA THỰC THỤ:
- Sản phẩm này LÀ GÌ? Mô tả kỹ thuật? Vật liệu chính? Chức năng chính?
- Theo GIR 1: chú giải CHƯƠNG NÀO mô tả sản phẩm này cụ thể nhất?
- Có phải hàng hỗn hợp/đa chức năng không? → GIR 3 cần xem xét?
- Mã nào DỄ NHẦM? Đâu là ranh giới phân loại?
- Cần tìm GÌ và Ở ĐÂU để phân loại chính xác?

LƯU Ý: Người dùng có thể viết KHÔNG DẤU (VD: "cam bien nhiet" = "cảm biến nhiệt"). Bạn PHẢI hiểu nghĩa.

Trả lời ĐÚNG JSON, không text khác:
{
  "product_understanding": "tôi hiểu sản phẩm này là... (1-2 câu)",
  "material_function": {"material": "vật liệu chính", "function": "chức năng chính", "state": "trạng thái: nguyên chiếc/tháo rời/bán thành phẩm"},
  "gir_thinking": "GIR nào áp dụng và tại sao (1 câu)",
  "possible_chapters": ["XX", "YY", "ZZ"],
  "investigation_plan": [
    {"tool": "search", "params": "từ khóa CÓ DẤU tiếng Việt", "why": "lý do tìm"},
    {"tool": "search", "params": "English keyword", "why": "tên quốc tế"},
    {"tool": "lookup", "params": "XXXXXXXX", "why": "mã HS tôi nghi ngờ nhất"},
    {"tool": "chapter", "params": "XX", "why": "xem toàn bộ nhóm trong chương"}
  ],
  "risk_alert": "điểm cần lưu ý: mã dễ nhầm, FTA ảnh hưởng, kiểm tra chuyên ngành..."
}

QUY TẮC:
- investigation_plan: 4-8 actions, ĐA DẠNG tool (search + lookup + chapter)
- possible_chapters: 2-4 chương, RỘNG hơn dự đoán ban đầu
- Ưu tiên search CÓ DẤU tiếng Việt + search tiếng Anh
- lookup: đoán 2-3 mã HS 8 số cụ thể nhất
- Nếu sản phẩm mơ hồ → investigation_plan RỘNG hơn, nhiều chapter hơn`;

// ============================================================
// PHASE 3: EXPERT ANALYZE — Đối chiếu GIR, TB-TCHQ, quyết định
// ============================================================
const ANALYZE_PROMPT = `Bạn là chuyên gia hải quan 20 năm kinh nghiệm. Bạn đã điều tra và có kết quả bên dưới.

KHÁCH HÀNG HỎI: "{message}"
{file_info}
{history}

NHẬN ĐỊNH BAN ĐẦU CỦA BẠN:
{think_summary}

KẾT QUẢ ĐIỀU TRA TỪ API (biểu thuế 2026, 9 tầng):
{investigation_data}

{knowledge_base}

─────────────────────────────────
6 QUY TẮC TỔNG QUÁT GIẢI THÍCH BIỂU THUẾ (GIR):
GIR 1: Phân loại theo tiêu đề nhóm + chú giải phần/chương — đây là quy tắc CƠ BẢN NHẤT
GIR 2a: Hàng chưa hoàn chỉnh/chưa lắp ráp → vẫn phân loại như hàng hoàn chỉnh
GIR 2b: Hỗn hợp/tổ hợp vật liệu → chuyển sang GIR 3
GIR 3a: Nhóm mô tả CỤ THỂ nhất được ưu tiên. 3b: Đặc trưng cơ bản quyết định. 3c: Nhóm thứ tự cuối
GIR 4: Hàng gần giống nhất
GIR 5: Bao bì chuyên dụng → phân loại cùng hàng hóa
GIR 6: Phân nhóm cùng cấp — so sánh phân nhóm, không so sánh nhóm
─────────────────────────────────

BÂY GIỜ HÃY LÀM NHƯ CHUYÊN GIA THỰC THỤ:

BƯỚC 1 — ĐỐI CHIẾU CHÚ GIẢI:
- Đọc legal_layer.chu_giai_chuong → sản phẩm có nằm trong "bao_gom" không?
- Đọc legal_layer.khong_bao_gom, loai_tru → có bị loại trừ khỏi nhóm nào không?
- SEN AHTN 2022 → mô tả chi tiết phân nhóm

BƯỚC 2 — KIỂM TRA TIỀN LỆ:
- precedent_layer.tb_tchq[] → có thông báo TCHQ nào phân loại sản phẩm tương tự?
- Nếu có → PHẢI trích dẫn số hiệu, tên SP, mã HS kết luận
- Nếu có tranh chấp → ghi nhận và cảnh báo

BƯỚC 3 — ÁP DỤNG GIR:
- GIR 1 đã đủ chưa? Hay cần GIR 2/3 cho hàng hỗn hợp?
- So sánh tối thiểu 3 mã HS — lập luận TẠI SAO chọn/loại mỗi mã

BƯỚC 4 — ĐÁNH GIÁ VÀ QUYẾT ĐỊNH:
- Confidence >= 60%: Đưa ra phân tích đầy đủ + đề xuất mã
- Confidence < 60%: VẪN liệt kê các mã tiềm năng, NHƯNG kèm 1-2 câu hỏi CỤ THỂ
  (VD: "Vật liệu vỏ ngoài là nhựa hay kim loại?" — KHÔNG hỏi chung chung)

─────────────────────────────────
FORMAT OUTPUT — viết ĐÚNG thứ tự, KHÔNG bỏ section, KHÔNG dùng bảng markdown:

📋 HỒ SƠ
Tên VN/EN, cấu tạo, chức năng (3 dòng)

📦 PHÂN LOẠI
Chức năng chính, GIR áp dụng, lập luận (2-3 dòng)

📊 SO SÁNH MÃ HS (≥3 mã, mỗi mã 1-2 dòng):
- **XXXX.XX.XX** — Mô tả ngắn | Phù hợp nếu: điều kiện | Căn cứ: chú giải/GIR/TB

💰 THUẾ (top 3 mã, CHỈ từ fact_layer — KHÔNG bịa):
- **XXXX.XX.XX**: MFN=X%, ACFTA=X%, VAT=X%, BVMT=X đ/kg (nếu có)

📝 ECUS: gợi ý mô tả khai báo cho từng mã (1 dòng/mã)

📜 CHÚ GIẢI: trích chú giải chương/nhóm áp dụng + SEN (3-5 dòng)

📋 KIỂM TRA CHUYÊN NGÀNH: giấy phép/kiểm dịch cần thiết hoặc "Không yêu cầu"

🔍 TB-TCHQ: trích số hiệu + tóm tắt nếu có, hoặc "Không phát hiện tiền lệ"

⚠️ RỦI RO: mã dễ nhầm + lý do hoặc "Rủi ro thấp"

🎯 KẾT LUẬN: mã đề xuất, confidence /100, nguồn trích dẫn, gợi ý tiếp theo
─────────────────────────────────

CHÚ Ý:
- Thuế suất PHẢI từ fact_layer. Không có → ghi "Chưa có dữ liệu thuế, cần xác minh"
- Mặc định xuất xứ TQ → ACFTA. Xuất xứ khác → FTA phù hợp
- PHẢI viết đủ 10 sections. Dùng bullet list, KHÔNG dùng bảng markdown
- Mọi kết luận phải có lập luận đủ giải trình trước Hải quan`;

// ============================================================
// HELPERS — parse search results, merge, etc.
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

function mergeResults(target, source) {
  for (const [key, items] of Object.entries(source)) {
    if (!target[key]) target[key] = [];
    target[key].push(...items);
  }
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
// PHASE 2: EXECUTE INVESTIGATION — chạy plan từ chuyên gia
// ============================================================
async function executeInvestigation(plan, apiLog) {
  const searchSources = { bieu_thue: [], tb_tchq: [], bao_gom: [], conflict: [] };
  let allResults = [];
  let hsDetails = [];

  // Execute all planned actions in parallel
  const actions = (plan.investigation_plan || []).slice(0, 8);
  const actionResults = await Promise.allSettled(
    actions.map(async (action) => {
      const { tool, params, why } = action;
      apiLog.push({ step: `investigate_${tool}`, params, why, status: 'calling' });

      try {
        if (tool === 'search') {
          const data = await searchHS(params, 10);
          const parsed = parseSearchResults(data);
          apiLog.push({ step: `investigate_${tool}`, params, status: 'done', count: parsed.all.length });
          return { type: 'search', parsed };
        }
        if (tool === 'lookup') {
          const detail = await getHSDetail(params);
          if (detail?.found !== false) {
            apiLog.push({ step: `investigate_${tool}`, params, status: 'done' });
            return { type: 'lookup', detail: { code: params, ...detail } };
          }
          // Exact not found → try chapter expansion
          const ch2 = params.substring(0, 2);
          const ch4 = params.substring(0, 4);
          apiLog.push({ step: `investigate_${tool}`, params, status: 'not_found_expanding', chapter: ch4 });
          const chapterData = await getChapter(ch2);
          const items = (chapterData?.items || chapterData?.results || []);
          const matching = items.filter(i => {
            const hs = i.hs || i.ma_hs || i.hs_code || '';
            return hs.startsWith(ch4);
          }).slice(0, 4);
          if (matching.length > 0) {
            const expanded = await Promise.allSettled(
              matching.slice(0, 3).map(async (item) => {
                const code = item.hs || item.ma_hs || item.hs_code;
                const d = await getHSDetail(code);
                return d?.found !== false ? { code, ...d } : null;
              })
            );
            const details = expanded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
            apiLog.push({ step: `investigate_${tool}`, params, status: 'expanded', found: details.length });
            return { type: 'lookup_expanded', details };
          }
          return null;
        }
        if (tool === 'chapter') {
          const chapterData = await getChapter(params);
          const items = (chapterData?.items || chapterData?.results || []).slice(0, 20);
          apiLog.push({ step: `investigate_${tool}`, params, status: 'done', count: items.length });
          return { type: 'chapter', items: items.map(i => ({ ...i, _source: `chapter_${params}` })) };
        }
        return null;
      } catch (e) {
        apiLog.push({ step: `investigate_${tool}`, params, status: 'error', error: e.message });
        return null;
      }
    })
  );

  // Collect results
  for (const r of actionResults) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const v = r.value;
    if (v.type === 'search') {
      mergeResults(searchSources, v.parsed.sources);
      allResults.push(...v.parsed.all);
    } else if (v.type === 'lookup') {
      hsDetails.push(v.detail);
      allResults.push({ hs: v.detail.code, _source: 'lookup', vn: v.detail.fact_layer?.vn || v.detail.code });
    } else if (v.type === 'lookup_expanded') {
      for (const d of v.details) {
        hsDetails.push(d);
        allResults.push({ hs: d.code, _source: 'lookup_expanded', vn: d.fact_layer?.vn || d.code });
      }
    } else if (v.type === 'chapter') {
      allResults.push(...v.items);
    }
  }

  allResults = dedup(allResults);

  // FALLBACK: If investigation returned 0 results, try direct message search
  if (allResults.length === 0 && plan.product_understanding) {
    apiLog.push({ step: 'investigate_fallback', status: 'calling' });
    const fallbackTerms = [
      plan.product_understanding,
      plan.material_function?.function,
      ...(plan.possible_chapters || []).map(ch => `chapter ${ch}`),
    ].filter(Boolean).slice(0, 4);

    const fallbackResults = await Promise.allSettled(
      fallbackTerms.map(async (term) => {
        try {
          const data = await searchHS(term, 10);
          return parseSearchResults(data);
        } catch { return null; }
      })
    );
    for (const r of fallbackResults) {
      if (r.status === 'fulfilled' && r.value) {
        mergeResults(searchSources, r.value.sources);
        allResults.push(...r.value.all);
      }
    }
    // Also try chapter expansion for guessed chapters
    for (const ch of (plan.possible_chapters || []).slice(0, 2)) {
      try {
        const chData = await getChapter(ch);
        const items = (chData?.items || chData?.results || []).slice(0, 15);
        allResults.push(...items.map(i => ({ ...i, _source: `chapter_${ch}` })));
      } catch { /* skip */ }
    }
    allResults = dedup(allResults);
    apiLog.push({ step: 'investigate_fallback', status: 'done', count: allResults.length });
  }

  // Fetch 9-layer details for top codes we don't already have
  const alreadyFetched = new Set(hsDetails.map(d => d.code));
  const topCodes = allResults
    .filter(r => !alreadyFetched.has(r.hs || r.ma_hs || r.hs_code))
    .slice(0, 5)
    .map(r => r.hs || r.ma_hs || r.hs_code)
    .filter(Boolean);

  if (topCodes.length > 0) {
    const detailResults = await Promise.allSettled(
      topCodes.slice(0, 4).map(async (code) => {
        apiLog.push({ step: 'hs_detail_extra', code, status: 'calling' });
        try {
          const detail = await getHSDetail(code);
          apiLog.push({ step: 'hs_detail_extra', code, status: detail?.found !== false ? 'done' : 'not_found' });
          return detail?.found !== false ? { code, ...detail } : null;
        } catch (e) {
          apiLog.push({ step: 'hs_detail_extra', code, status: 'error', error: e.message });
          return null;
        }
      })
    );
    hsDetails.push(...detailResults.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value));
  }

  return { searchSources, allResults, hsDetails };
}

// ============================================================
// BUILD CONTEXT — compact 9-layer data for analysis prompt
// ============================================================
function buildInvestigationContext(searchSources, allResults, hsDetails) {
  const parts = [];

  if (allResults.length > 0) {
    const trimmed = allResults.slice(0, 10).map(r => ({
      hs: r.hs || r.ma_hs || r.hs_code,
      vn: (r.vn || r.ten_vn || r.mo_ta || '').substring(0, 80),
      src: r._source,
    }));
    parts.push(`KẾT QUẢ TÌM KIẾM (${allResults.length} mã):${JSON.stringify(trimmed)}`);
  }

  if (searchSources.tb_tchq.length > 0) {
    const tb = searchSources.tb_tchq.slice(0, 4).map(t => ({
      tb: t.so_hieu, sp: (t.ten_san_pham || '').substring(0, 80), hs: t.ma_hs,
      ly_do: (t.ly_do_phan_loai || '').substring(0, 150),
    }));
    parts.push(`TB-TCHQ (${searchSources.tb_tchq.length} thông báo):${JSON.stringify(tb)}`);
  }

  if (searchSources.conflict.length > 0) {
    const conflict = searchSources.conflict.slice(0, 3).map(c => ({
      hs: c.hs || c.ma_hs, vn: (c.vn || c.mo_ta || '').substring(0, 60),
    }));
    parts.push(`XUNG ĐỘT MÃ:${JSON.stringify(conflict)}`);
  }

  if (hsDetails.length > 0) {
    const details = hsDetails.slice(0, 4).map(d => {
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
        if (d.legal_layer.chu_giai_chuong) detail.legal.chuong = typeof d.legal_layer.chu_giai_chuong === 'string' ? d.legal_layer.chu_giai_chuong.substring(0, 600) : d.legal_layer.chu_giai_chuong;
        if (d.legal_layer.chu_giai_nhom) detail.legal.nhom = typeof d.legal_layer.chu_giai_nhom === 'string' ? d.legal_layer.chu_giai_nhom.substring(0, 400) : d.legal_layer.chu_giai_nhom;
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
    parts.push(`CHI TIẾT 9 TẦNG (${hsDetails.length} mã):${JSON.stringify(details)}`);
  }

  return parts.join('\n\n───\n\n');
}

// ============================================================
// MAIN: handleCustoms — Reasoning Agent architecture
// ============================================================
export async function handleCustoms({ message, history, file, apiKey }) {
  const apiLog = [];
  const fileInfo = file ? `[File đính kèm: ${file.name} (${file.mimeType})]` : '';
  const historyText = formatHistory(history);

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: EXPERT THINK — Chuyên gia phân tích & lập kế hoạch
  // ═══════════════════════════════════════════════════════════
  apiLog.push({ step: 'phase1_think', status: 'calling' });

  let thinkResult;
  try {
    const thinkPrompt = THINK_PROMPT
      .replace('{message}', message || '(xem file đính kèm)')
      .replace('{file_info}', fileInfo ? `\n${fileInfo} — Hãy nhận diện sản phẩm từ hình ảnh/file.` : '')
      .replace('{history}', historyText ? `\nNGỮ CẢNH HỘI THOẠI:${historyText}` : '');

    const raw = await callLLM(thinkPrompt, apiKey, {
      file, model: MODELS.FAST, temperature: 0.3, maxTokens: 2000,
    });

    let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (!cleaned.startsWith('{')) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
    }
    thinkResult = JSON.parse(cleaned);
    apiLog.push({ step: 'phase1_think', status: 'done', plan_actions: thinkResult.investigation_plan?.length || 0 });
  } catch (thinkError) {
    apiLog.push({ step: 'phase1_think', status: 'error', error: thinkError.message });
    // Fallback: build a basic plan from the message
    const text = (message || '').trim();
    thinkResult = {
      product_understanding: text,
      material_function: { material: 'chưa rõ', function: text, state: 'chưa rõ' },
      gir_thinking: 'GIR 1 — cần xác định nhóm hàng',
      possible_chapters: [],
      investigation_plan: [
        { tool: 'search', params: text, why: 'tìm trực tiếp' },
        ...(text.split(/\s+/).length > 1 ? text.split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => (
          { tool: 'search', params: w, why: 'từ khóa đơn' }
        )) : []),
      ],
      risk_alert: 'Không thể phân tích sâu do lỗi LLM',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: INVESTIGATE — Thực thi kế hoạch điều tra
  // ═══════════════════════════════════════════════════════════
  apiLog.push({ step: 'phase2_investigate', status: 'calling' });

  const { searchSources, allResults, hsDetails } = await executeInvestigation(thinkResult, apiLog);

  apiLog.push({
    step: 'phase2_investigate', status: 'done',
    results: allResults.length, details: hsDetails.length,
    tb_tchq: searchSources.tb_tchq.length,
  });

  // Query Knowledge Base
  let knowledgeItems = [];
  const allHSCodes = [...new Set(
    allResults.map(r => r.hs || r.ma_hs || r.hs_code).filter(Boolean)
  )];
  if (allHSCodes.length > 0) {
    try {
      knowledgeItems = await searchByHSCodes(allHSCodes, 5);
      if (knowledgeItems.length > 0) {
        apiLog.push({ step: 'kb_query', status: 'done', items: knowledgeItems.length });
        trackUsage(knowledgeItems.map(i => i.id)).catch(() => {});
      }
    } catch { /* KB not available */ }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: EXPERT ANALYZE — Đối chiếu GIR + quyết định
  // ═══════════════════════════════════════════════════════════
  const investigationData = buildInvestigationContext(searchSources, allResults, hsDetails);
  const hasData = allResults.length > 0 || hsDetails.length > 0;

  const thinkSummary = `Sản phẩm: ${thinkResult.product_understanding || message}
Vật liệu: ${thinkResult.material_function?.material || 'chưa rõ'} | Chức năng: ${thinkResult.material_function?.function || 'chưa rõ'}
GIR: ${thinkResult.gir_thinking || 'chưa xác định'}
Chương dự kiến: ${(thinkResult.possible_chapters || []).join(', ') || 'chưa xác định'}
Lưu ý: ${thinkResult.risk_alert || 'không'}`;

  const kbSection = knowledgeItems.length > 0
    ? `\nKIẾN THỨC ĐÃ HỌC:\n${knowledgeItems.map(i => `[${i.type}] ${i.content} (confidence: ${i.confidence})`).join('\n')}`
    : '';

  let analysisPrompt;
  if (hasData) {
    analysisPrompt = ANALYZE_PROMPT
      .replace('{message}', message || '(xem file đính kèm)')
      .replace('{file_info}', fileInfo)
      .replace('{history}', historyText)
      .replace('{think_summary}', thinkSummary)
      .replace('{investigation_data}', investigationData)
      .replace('{knowledge_base}', kbSection);
  } else {
    // No data found — ask expert to reason from knowledge + suggest chapters
    analysisPrompt = `Bạn là chuyên gia hải quan 20 năm kinh nghiệm.

KHÁCH HÀNG HỎI: "${message || '(xem file đính kèm)'}"
${fileInfo}
${historyText}

NHẬN ĐỊNH: ${thinkSummary}

Đã tìm kiếm API nhưng KHÔNG tìm thấy kết quả chính xác.

BẮT BUỘC — KHÔNG ĐƯỢC chỉ hỏi "bạn cho biết thêm" mà không đưa kết quả:
1. Dựa trên kiến thức chuyên gia, liệt kê ≥3 mã HS tiềm năng + lý do
2. Với mỗi mã, giải thích ĐIỀU KIỆN nào thì phù hợp
3. Nếu cần phân biệt → hỏi 1-2 câu CỤ THỂ (vật liệu? kích thước? chức năng?)
4. Gợi ý: "Sản phẩm của bạn gần nhất với mã nào?"

Trả lời tiếng Việt, dùng bullet list, không dùng bảng markdown.`;
  }

  apiLog.push({ step: 'phase3_analyze', status: 'calling' });
  let analysis;
  try {
    analysis = await callLLM(analysisPrompt, apiKey, { file, model: MODELS.HEAVY, maxTokens: 12000 });
    apiLog.push({ step: 'phase3_analyze', status: 'done', length: analysis.length });
  } catch (llmError) {
    apiLog.push({ step: 'phase3_analyze', status: 'error', error: llmError.message });
    // Fallback: raw data display
    if (hasData) {
      const codeList = allResults.slice(0, 10).map(r => {
        const hs = r.hs || r.ma_hs || r.hs_code || '';
        const vn = r.vn || r.ten_vn || r.mo_ta || '';
        return `- **${hs}** — ${vn}`;
      }).join('\n');
      analysis = `📊 **Kết quả tra cứu cho "${message}"**\n\nTìm thấy ${allResults.length} mã HS tiềm năng:\n${codeList}\n\n⚠️ *Phân tích chi tiết tạm không khả dụng. Chọn mã HS để xem thuế suất.*`;
    } else {
      analysis = `Đã tìm kiếm "${message}" nhưng chưa tìm thấy mã HS phù hợp.\nVui lòng mô tả chi tiết: vật liệu, chức năng, công dụng cụ thể.`;
    }
  }

  return {
    reply: analysis,
    debug: {
      agent: 'customs',
      architecture: 'reasoning_agent_v2',
      phase1_think: {
        product: thinkResult.product_understanding,
        chapters: thinkResult.possible_chapters,
        gir: thinkResult.gir_thinking,
        risk: thinkResult.risk_alert,
        actions: (thinkResult.investigation_plan || []).length,
      },
      phase2_investigate: {
        searchResultCount: allResults.length,
        hsDetailsLoaded: hsDetails.length,
        tb_tchq: searchSources.tb_tchq.length,
        searchSources: {
          bieu_thue: searchSources.bieu_thue.length,
          tb_tchq: searchSources.tb_tchq.length,
          bao_gom: searchSources.bao_gom.length,
          conflict: searchSources.conflict.length,
        },
      },
      phase3_analyze: { length: analysis?.length || 0 },
      hasData,
      knowledgeItemsUsed: knowledgeItems.length,
      file: file ? { name: file.name, mimeType: file.mimeType } : null,
      apiCalls: apiLog,
    },
  };
}
