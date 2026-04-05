import { searchHS, getHSDetail } from '../hsApi';
import { callLLM, MODELS, formatHistory } from './shared';
import { searchByHSCodes, trackUsage } from '../stores/knowledgeStore';

const SYSTEM_PROMPT = `Chuyên gia HS Code VN (Biểu thuế 2026). Trả lời tiếng Việt.
Thuế suất CHỈ lấy từ fact_layer API, KHÔNG bịa. Mặc định xuất xứ TQ → ACFTA.
KHÔNG chốt mã nếu chưa check TB-TCHQ. Chú giải 2022 ưu tiên hơn 2017.

FORMAT BẮT BUỘC:
📋 HỒ SƠ: Tên VN/EN, cấu tạo, chức năng, công dụng
📦 PHÂN LOẠI: Chức năng chính, trạng thái
📊 SO SÁNH (bảng ≥3 mã): | Mã HS | Mô tả | Căn cứ | Kết luận |
💰 THUẾ (bảng từ fact_layer): MFN, ACFTA, VAT, TTĐB, BVMT
📝 MÔ TẢ ECUS
🔍 TB-TCHQ: trích số TB nếu có, hoặc "✅ Không phát hiện"
⚠️ RỦI RO: mã dễ nhầm từ conflict_layer
🎯 KẾT LUẬN: mã đề xuất, điểm tự tin /100, phản đề, nguồn`;

// ============================================================
// PARSE SEARCH RESULTS — handle cả 2 format API response
// ============================================================
function parseSearchResults(searchData) {
  const sources = { bieu_thue: [], tb_tchq: [], bao_gom: [], conflict: [] };
  const all = [];

  if (!searchData?.results) return { sources, all };

  const results = searchData.results;

  for (const [source, data] of Object.entries(results)) {
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

// ============================================================
// SMART SEARCH — 4-tier fallback strategy
// ============================================================
async function smartSearch(keywords, apiLog) {
  const searchSources = { bieu_thue: [], tb_tchq: [], bao_gom: [], conflict: [] };
  let allResults = [];
  let strategy = 'none';

  // Helper: parallel search for a tier
  async function parallelSearch(kwList, step) {
    const logs = [];
    const results = await Promise.allSettled(
      kwList.map(async (kw) => {
        logs.push({ step, keyword: kw, status: 'calling' });
        const data = await searchHS(kw, 10);
        const parsed = parseSearchResults(data);
        logs.push({ step, keyword: kw, status: 'done', resultCount: parsed.all.length });
        return parsed;
      })
    );
    for (const log of logs) apiLog.push(log);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        mergeResults(searchSources, r.value.sources);
        allResults.push(...r.value.all);
      }
    }
  }

  // --- TIER 1: Primary keywords (PARALLEL) ---
  await parallelSearch((keywords.primary || []).slice(0, 3), 'search_t1_primary');
  if (allResults.length > 0) strategy = 'tier1_primary';

  // --- TIER 2: Short keywords (PARALLEL, only if <3 results) ---
  if (allResults.length < 3) {
    await parallelSearch((keywords.short || []).slice(0, 3), 'search_t2_short');
    if (allResults.length > 0 && strategy === 'none') strategy = 'tier2_short';
  }

  // --- TIER 3: English keywords (PARALLEL) ---
  if (allResults.length < 3) {
    await parallelSearch((keywords.en || []).slice(0, 2), 'search_t3_english');
    if (allResults.length > 0 && strategy === 'none') strategy = 'tier3_english';
  }

  // --- TIER 4: Direct HS code guess (PARALLEL) ---
  let guessDetails = [];
  if (allResults.length < 3 && keywords.hs_guess?.length > 0) {
    const guessResults = await Promise.allSettled(
      keywords.hs_guess.slice(0, 3).map(async (code) => {
        apiLog.push({ step: 'search_t4_hs_guess', code, status: 'calling' });
        const detail = await getHSDetail(code);
        if (detail?.found !== false) {
          apiLog.push({ step: 'search_t4_hs_guess', code, status: 'done' });
          return { code, ...detail };
        }
        apiLog.push({ step: 'search_t4_hs_guess', code, status: 'not_found' });
        return null;
      })
    );
    for (const r of guessResults) {
      if (r.status === 'fulfilled' && r.value) {
        guessDetails.push(r.value);
        allResults.push({ hs: r.value.code, _source: 'hs_guess', vn: r.value.fact_layer?.vn || r.value.code });
      }
    }
    if (allResults.length > 0 && strategy === 'none') strategy = 'tier4_hs_guess';
  }

  // Deduplicate
  const seen = new Set();
  allResults = allResults.filter(r => {
    const key = r.hs || r.ma_hs || r.hs_code || r.so_hieu || JSON.stringify(r).substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { searchSources, allResults, strategy, guessDetails };
}

/**
 * Customs Agent — HS code classification pipeline
 * Full 4-tier smart search + 9-layer analysis
 */
export async function handleCustoms({ message, history, file, apiKey }) {
  const apiLog = [];
  const fileInfo = file ? `\n[Người dùng đính kèm file: ${file.name} (${file.mimeType}). Hãy phân tích nội dung file này kết hợp với mô tả.]` : '';

  // === BƯỚC 1: Gemini trích xuất 4 tầng keyword ===
  const extractPrompt = `Người dùng mô tả hàng hóa: "${message || '(xem file đính kèm)'}"${fileInfo}

Bạn là chuyên gia phân loại HS Code Việt Nam. Hãy phân tích mô tả hàng hóa và trích xuất từ khóa để tìm trong biểu thuế.

Trả lời ĐÚNG định dạng JSON sau, không có text khác:
{
  "primary": ["cụm từ kỹ thuật đầy đủ tiếng Việt có dấu, 2-4 từ"],
  "short": ["từ khóa ngắn 1-2 từ tiếng Việt có dấu — tên gọi phổ biến, tên chức năng"],
  "en": ["English technical name", "English common name"],
  "hs_guess": ["XXXX hoặc XXXXXXXX — mã chương 4 số hoặc mã HS 8 số bạn đoán"]
}

QUY TẮC:
- primary: 1-2 cụm từ kỹ thuật chính xác trong biểu thuế VN (VD: "máy thu phát vô tuyến", "vít thép không gỉ")
- short: 2-3 từ đơn ngắn gọn, dễ match (VD: "vô tuyến", "bộ đàm", "vít thép")
- en: 1-2 tên tiếng Anh phổ biến (VD: "walkie talkie", "stainless steel screw")
- hs_guess: 1-2 mã HS 4-8 số bạn tin là đúng nhất (VD: "8517", "73181490")
- Nếu là ảnh: nhận diện sản phẩm rồi trích keywords`;

  apiLog.push({ step: 'llm_extract', status: 'calling' });
  const keywordsRaw = await callLLM(extractPrompt, apiKey, { file, model: MODELS.FAST });

  let keywords = { primary: [], short: [], en: [], hs_guess: [] };
  try {
    const cleaned = keywordsRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    keywords = {
      primary: parsed.primary || parsed.keywords || [],
      short: parsed.short || [],
      en: parsed.en || [],
      hs_guess: parsed.hs_guess || [],
    };
  } catch {
    if (message?.trim()) {
      keywords.primary = [message.trim()];
      const words = message.trim().split(/\s+/);
      if (words.length > 2) {
        keywords.short = words.filter(w => w.length > 1);
      }
    }
  }
  apiLog[apiLog.length - 1] = { step: 'llm_extract', status: 'done', keywords };

  // === BƯỚC 2: Smart 4-tier search ===
  const { searchSources, allResults, strategy, guessDetails } = await smartSearch(keywords, apiLog);

  // === BƯỚC 3: Lấy chi tiết 9 tầng cho top mã HS ===
  let hsDetails = [...guessDetails];

  const topCodes = allResults
    .filter(r => r._source === 'bieu_thue' || r._source === 'tb_tchq' || r._source === 'hs_guess')
    .slice(0, 5)
    .map(r => r.hs || r.ma_hs || r.hs_code)
    .filter(Boolean);

  const baogomCodes = allResults
    .filter(r => r._source === 'bao_gom')
    .slice(0, 3)
    .map(r => r.hs || r.ma_hs)
    .filter(Boolean);

  const allCodesToFetch = [...new Set([...topCodes, ...baogomCodes])];
  const alreadyFetched = new Set(guessDetails.map(d => d.code));
  const codesToFetch = allCodesToFetch.filter(c => !alreadyFetched.has(c));

  // Parallel fetch all HS details
  const detailResults = await Promise.allSettled(
    codesToFetch.slice(0, 5).map(async (code) => {
      apiLog.push({ step: 'hs_detail', code, status: 'calling' });
      try {
        const detail = await getHSDetail(code);
        apiLog.push({ step: 'hs_detail', code, status: detail?.found !== false ? 'done' : 'not_found' });
        return detail?.found !== false ? { code, ...detail } : null;
      } catch (e) {
        apiLog.push({ step: 'hs_detail', code, status: 'error', error: e.message });
        return null;
      }
    })
  );
  hsDetails.push(...detailResults.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value));

  const hasData = allResults.length > 0 || hsDetails.length > 0;

  // === BƯỚC 3.5: Query Knowledge Base for learned insights ===
  let knowledgeItems = [];
  const allHSCodes = [...new Set([...topCodes, ...baogomCodes])];
  if (allHSCodes.length > 0) {
    try {
      knowledgeItems = await searchByHSCodes(allHSCodes, 5);
      if (knowledgeItems.length > 0) {
        apiLog.push({ step: 'kb_query', status: 'done', items: knowledgeItems.length });
        trackUsage(knowledgeItems.map(i => i.id)).catch(() => {});
      }
    } catch {
      // KB not available — continue without it
    }
  }

  // === BƯỚC 4: LLM phân tích ===
  // Truncate data to fit within token limits (~15K tokens max for context)
  const contextParts = [];

  if (allResults.length > 0) {
    // Only keep top 10 results with essential fields
    const trimmedResults = allResults.slice(0, 10).map(r => ({
      hs: r.hs || r.ma_hs || r.hs_code,
      vn: r.vn || r.ten_vn || r.mo_ta,
      en: r.en || r.ten_en,
      _source: r._source,
    }));
    contextParts.push(`KẾT QUẢ TÌM KIẾM (${allResults.length} kết quả, strategy: ${strategy}):\n${JSON.stringify(trimmedResults, null, 2)}`);
  }
  if (searchSources.tb_tchq.length > 0) {
    const trimmedTB = searchSources.tb_tchq.slice(0, 5).map(t => ({
      so_hieu: t.so_hieu, ten_san_pham: t.ten_san_pham, ma_hs: t.ma_hs,
      ly_do_phan_loai: t.ly_do_phan_loai, tranh_chap: t.tranh_chap,
    }));
    contextParts.push(`TIỀN LỆ TB-TCHQ:\n${JSON.stringify(trimmedTB, null, 2)}`);
  }
  if (searchSources.conflict.length > 0) {
    contextParts.push(`MÃ DỄ NHẦM / CONFLICT:\n${JSON.stringify(searchSources.conflict.slice(0, 5), null, 2)}`);
  }
  if (hsDetails.length > 0) {
    // Extract only essential layers, truncate large text fields
    const trimmedDetails = hsDetails.map(d => ({
      code: d.code,
      fact_layer: d.fact_layer ? {
        vn: d.fact_layer.vn, en: d.fact_layer.en,
        mfn: d.fact_layer.mfn, acfta: d.fact_layer.acfta,
        vat: d.fact_layer.vat, bvmt: d.fact_layer.bvmt,
        ttdb: d.fact_layer.ttdb,
      } : null,
      legal_layer: d.legal_layer ? {
        chu_giai_chuong: typeof d.legal_layer.chu_giai_chuong === 'string'
          ? d.legal_layer.chu_giai_chuong.substring(0, 500) : d.legal_layer.chu_giai_chuong,
        chu_giai_nhom: typeof d.legal_layer.chu_giai_nhom === 'string'
          ? d.legal_layer.chu_giai_nhom.substring(0, 500) : d.legal_layer.chu_giai_nhom,
        bao_gom: d.legal_layer.bao_gom,
        khong_bao_gom: d.legal_layer.khong_bao_gom,
        loai_tru: d.legal_layer.loai_tru,
      } : null,
      precedent_layer: d.precedent_layer?.tb_tchq?.slice(0, 3) || null,
      conflict_layer: d.conflict_layer || null,
    }));
    contextParts.push(`CHI TIẾT 9 TẦNG (${hsDetails.length} mã):\n${JSON.stringify(trimmedDetails, null, 2)}`);
  }

  // Inject learned knowledge from KB
  if (knowledgeItems.length > 0) {
    const kbText = knowledgeItems.map(item =>
      `[${item.type}] ${item.content} (confidence: ${item.confidence}, used: ${item.used_count}x)`
    ).join('\n');
    contextParts.push(`KIẾN THỨC ĐÃ HỌC (từ các hội thoại trước):\n${kbText}`);
  }

  const historyText = formatHistory(history);
  let analysisPrompt;

  if (hasData) {
    analysisPrompt = `${SYSTEM_PROMPT}
${historyText}
Người dùng hỏi: "${message || '(xem file đính kèm)'}"${fileInfo}

DỮ LIỆU TỪ HS KNOWLEDGE API (9 tầng):
${contextParts.join('\n\n---\n\n')}

HƯỚNG DẪN PHÂN TÍCH:
1. Đọc fact_layer → thuế suất thực tế (MFN, ACFTA, VAT, BVMT)
2. Đọc legal_layer → chú giải chương, nhóm, bao_gom, khong_bao_gom, SEN
3. Đọc precedent_layer.tb_tchq[] → có tiền lệ phân loại không?
4. Đọc conflict_layer → có mã dễ nhầm, rủi ro tranh chấp không?
5. Áp dụng Tư duy 3 tầng → so sánh tối thiểu 3 mã
6. Trả lời ĐÚNG FORMAT OUTPUT trong system prompt (bắt buộc)

CHÚ Ý QUAN TRỌNG:
- Thuế suất PHẢI lấy từ fact_layer — KHÔNG ĐƯỢC tự bịa số
- Nếu fact_layer không có thuế → ghi "Chưa có dữ liệu, cần xác minh"
- TB-TCHQ nếu có → trích dẫn đầy đủ số hiệu, năm, lý do
- Phải dựa trên DỮ LIỆU API ở trên, KHÔNG dùng kiến thức riêng cho thuế suất`;
  } else {
    analysisPrompt = `${SYSTEM_PROMPT}
${historyText}
Người dùng hỏi: "${message || '(xem file đính kèm)'}"${fileInfo}

⛔ KHÔNG TÌM THẤY DỮ LIỆU TRONG CƠ SỞ DỮ LIỆU HS.
Từ khóa đã thử: ${JSON.stringify(keywords)}
Tất cả 4 tầng search đều trả 0 kết quả.

BẮT BUỘC: Bạn KHÔNG ĐƯỢC tự đưa ra mã HS hoặc thuế suất khi không có dữ liệu API.
Thay vào đó, hãy:
1. Mô tả sản phẩm bạn hiểu từ câu hỏi/file
2. Giải thích tại sao không tìm thấy (từ khóa quá chung? sản phẩm đặc thù?)
3. Đặt 2-3 CÂU HỎI CỤ THỂ để thu hẹp tìm kiếm:
   - Hàng thuộc chương nào? (ví dụ: máy móc Ch.84, điện tử Ch.85, hóa chất Ch.28-38...)
   - Vật liệu chính? (thép, nhựa, gỗ, vải...)
   - Chức năng cụ thể? (đo, cắt, truyền tín hiệu, lọc...)
   - Mã HS user đã biết hoặc đang dùng?
4. Gợi ý từ khóa khác user có thể thử

Trả lời bằng tiếng Việt, thân thiện, chuyên nghiệp.`;
  }

  apiLog.push({ step: 'llm_analysis', status: 'calling' });
  const analysis = await callLLM(analysisPrompt, apiKey, { file, model: MODELS.HEAVY });
  apiLog[apiLog.length - 1] = { step: 'llm_analysis', status: 'done' };

  return {
    reply: analysis,
    debug: {
      agent: 'customs',
      keywords,
      strategy,
      hasData,
      file: file ? { name: file.name, mimeType: file.mimeType, size: file.data?.length ? Math.round(file.data.length * 3 / 4 / 1024) + ' KB' : 'unknown' } : null,
      apiCalls: apiLog,
      searchResultCount: allResults.length,
      searchSources: {
        bieu_thue: searchSources.bieu_thue.length,
        tb_tchq: searchSources.tb_tchq.length,
        bao_gom: searchSources.bao_gom.length,
        conflict: searchSources.conflict.length,
      },
      hsCodesAnalyzed: [...new Set([...topCodes, ...baogomCodes])],
      hsDetailsLoaded: hsDetails.length,
      knowledgeItemsUsed: knowledgeItems.length,
    },
  };
}
