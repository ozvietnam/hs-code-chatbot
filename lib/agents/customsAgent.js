import { searchHS, getHSDetail, getChapter } from '../hsApi';
import { callLLM, MODELS, formatHistory } from './shared';
import { searchByHSCodes, trackUsage } from '../stores/knowledgeStore';

const SYSTEM_PROMPT = `Chuyên gia HS Code VN (Biểu thuế 2026). Trả lời tiếng Việt.
Thuế suất CHỈ lấy từ fact_layer API, KHÔNG bịa. Mặc định xuất xứ TQ → ACFTA.
KHÔNG chốt mã nếu chưa check TB-TCHQ. Chú giải 2022 ưu tiên hơn 2017.

NGUYÊN TẮC QUAN TRỌNG NHẤT:
- LUÔN CHỦ ĐỘNG tra cứu và đưa ra các mã HS tiềm năng để user CHỌN
- KHÔNG BAO GIỜ hỏi ngược user "bạn cho biết thêm", "bạn cung cấp thêm" khi chưa thử tra cứu
- Nếu mô tả chung chung → mở rộng tìm kiếm, liệt kê TẤT CẢ mã có thể phù hợp
- Luôn so sánh ≥3 mã HS, để user tự chọn mã phù hợp nhất
- Chỉ hỏi user KHI ĐÃ liệt kê xong các lựa chọn VÀ cần phân biệt giữa chúng

FORMAT BẮT BUỘC:
📋 HỒ SƠ: Tên VN/EN, cấu tạo, chức năng, công dụng
📦 PHÂN LOẠI: Chức năng chính, trạng thái, GIR áp dụng
📊 SO SÁNH (bảng ≥3 mã): | Mã HS | Mô tả | Căn cứ | Kết luận |
💰 THUẾ (bảng từ fact_layer): MFN, ACFTA, VAT, TTĐB, BVMT
📝 MÔ TẢ ECUS
📜 CHÚ GIẢI & SEN: trích chú giải chương/nhóm, SEN AHTN 2022 nếu có
📋 KIỂM TRA CHUYÊN NGÀNH: giấy phép, kiểm dịch, điều kiện NK từ regulatory_layer
🔍 TB-TCHQ: trích số TB nếu có, hoặc "✅ Không phát hiện"
⚠️ RỦI RO: mã dễ nhầm từ conflict_layer
🚢 LOGISTICS: giá tham chiếu, cửa khẩu gợi ý nếu có
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
// GUESS FALLBACK CHAPTERS — khi search chính không ra kết quả
// Dùng LLM đoán nhanh chương HS liên quan, rồi search mở rộng
// ============================================================
async function guessFallbackChapters(keywords, message, apiKey) {
  const prompt = `Sản phẩm: "${message}"
Từ khóa đã thử: ${JSON.stringify(keywords)}

Bạn là chuyên gia HS Code. Không tìm thấy kết quả chính xác.
Hãy đoán 3 CHƯƠNG HS (2 số) có thể chứa sản phẩm này và cho từ khóa tìm trong mỗi chương.

Trả lời ĐÚNG JSON, không text khác:
[
  {"chapter": "85", "keyword": "thiết bị điện", "reason": "linh kiện điện tử"},
  {"chapter": "84", "keyword": "máy móc", "reason": "thiết bị cơ khí"}
]`;

  try {
    const raw = await callLLM(prompt, apiKey, { temperature: 0.1, maxTokens: 500, model: MODELS.FAST });
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // Fallback: dùng từ khóa gốc
    return (keywords.primary || []).slice(0, 2).map(k => ({ chapter: '', keyword: k, reason: 'primary keyword' }));
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

  // --- TIER 2: Short keywords (PARALLEL) — always run to get more options ---
  if (allResults.length < 5) {
    await parallelSearch((keywords.short || []).slice(0, 4), 'search_t2_short');
    if (allResults.length > 0 && strategy === 'none') strategy = 'tier2_short';
  }

  // --- TIER 3: English keywords (PARALLEL) ---
  if (allResults.length < 5) {
    await parallelSearch((keywords.en || []).slice(0, 3), 'search_t3_english');
    if (allResults.length > 0 && strategy === 'none') strategy = 'tier3_english';
  }

  // --- TIER 4: Direct HS code guess (PARALLEL) — always try if we have guesses ---
  let guessDetails = [];
  if (keywords.hs_guess?.length > 0) {
    const guessResults = await Promise.allSettled(
      keywords.hs_guess.slice(0, 4).map(async (code) => {
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
- primary: 2-3 cụm từ kỹ thuật chính xác trong biểu thuế VN (VD: "máy thu phát vô tuyến", "vít thép không gỉ")
- short: 3-4 từ đơn ngắn gọn, dễ match — bao gồm tên phổ biến VÀ biến thể (VD: "vô tuyến", "bộ đàm", "radio", "vít thép")
- en: 2-3 tên tiếng Anh phổ biến (VD: "walkie talkie", "two-way radio", "stainless steel screw")
- hs_guess: 2-4 mã HS 4-8 số — đoán RỘNG, bao gồm cả mã lân cận (VD: "8517", "8525", "73181490", "73181590")
- Ưu tiên đoán NHIỀU mã hơn là đoán CHÍNH XÁC — mục tiêu là không bỏ sót
- Nếu là ảnh: nhận diện sản phẩm rồi trích keywords`;

  apiLog.push({ step: 'llm_extract', status: 'calling' });
  let keywords = { primary: [], short: [], en: [], hs_guess: [] };

  try {
    const keywordsRaw = await callLLM(extractPrompt, apiKey, { file, model: MODELS.FAST });
    const cleaned = keywordsRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    keywords = {
      primary: parsed.primary || parsed.keywords || [],
      short: parsed.short || [],
      en: parsed.en || [],
      hs_guess: parsed.hs_guess || [],
    };
    apiLog[apiLog.length - 1] = { step: 'llm_extract', status: 'done', keywords };
  } catch (extractError) {
    // LLM failed → fallback to simple keyword extraction from message text
    apiLog[apiLog.length - 1] = { step: 'llm_extract', status: 'error', error: extractError.message };
    if (message?.trim()) {
      const text = message.trim();
      keywords.primary = [text];
      const words = text.split(/\s+/).filter(w => w.length > 1);
      keywords.short = words.length > 1 ? words : [text];
      // Use full message as search term — don't lose the query
    }
    apiLog.push({ step: 'llm_extract_fallback', status: 'done', keywords });
  }

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
    // Extract all 9 layers with appropriate truncation
    const trimmedDetails = hsDetails.map(d => {
      const detail = {
        code: d.code,
        // Tầng 1: Thuế suất
        fact_layer: d.fact_layer ? {
          vn: d.fact_layer.vn, en: d.fact_layer.en,
          mfn: d.fact_layer.mfn, acfta: d.fact_layer.acfta,
          atiga: d.fact_layer.atiga,
          vat: d.fact_layer.vat, bvmt: d.fact_layer.bvmt,
          ttdb: d.fact_layer.ttdb,
          chinh_sach: d.fact_layer.chinh_sach,
          canh_bao: d.fact_layer.canh_bao,
        } : null,
        // Tầng 2: Chú giải pháp lý + SEN
        legal_layer: d.legal_layer ? {
          chu_giai_chuong: typeof d.legal_layer.chu_giai_chuong === 'string'
            ? d.legal_layer.chu_giai_chuong.substring(0, 1500) : d.legal_layer.chu_giai_chuong,
          chu_giai_nhom: typeof d.legal_layer.chu_giai_nhom === 'string'
            ? d.legal_layer.chu_giai_nhom.substring(0, 1500) : d.legal_layer.chu_giai_nhom,
          bao_gom: d.legal_layer.bao_gom,
          khong_bao_gom: d.legal_layer.khong_bao_gom,
          loai_tru: d.legal_layer.loai_tru,
          tinh_chat: d.legal_layer.tinh_chat,
          sen: d.legal_layer.sen,
        } : null,
        // Tầng 3: Kiểm tra chuyên ngành
        regulatory_layer: d.regulatory_layer || null,
        // Tầng 4: Tiền lệ TB-TCHQ
        precedent_layer: d.precedent_layer?.tb_tchq?.slice(0, 5) || null,
        // Tầng 5: Mã dễ nhầm
        conflict_layer: d.conflict_layer || null,
        // Tầng 6: GIR classification
        classification_layer: d.classification_layer || null,
        // Tầng 7: WCO / AHTN
        cross_border_layer: d.cross_border_layer || null,
      };
      // Tầng 8: Logistics (giá tham chiếu, cửa khẩu) — chỉ thêm nếu có data
      if (d.logistics_layer) {
        detail.logistics_layer = d.logistics_layer;
      }
      return detail;
    });
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

HƯỚNG DẪN PHÂN TÍCH 9 TẦNG (BẮT BUỘC theo thứ tự):
1. fact_layer → thuế suất thực tế: MFN, ACFTA, ATIGA, VAT, BVMT, TTĐB, chính sách, cảnh báo
2. legal_layer → chú giải chương/nhóm (CV 1810/TCHQ-TXNK 2022), bao_gom, khong_bao_gom, loai_tru, tinh_chat, SEN AHTN 2022
3. regulatory_layer → kiểm tra chuyên ngành, kiểm dịch, giấy phép nhập khẩu — PHẢI thông báo nếu có
4. precedent_layer → TB-TCHQ thực tế: trích số hiệu, tên SP, mã HS, lý do phân loại, tranh chấp
5. conflict_layer → mã dễ nhầm, mức rủi ro (ORANGE/RED), lịch sử tranh chấp
6. classification_layer → GIR checklist, confidence score
7. cross_border_layer → WCO 6 số ↔ AHTN 8 số mapping
8. logistics_layer → giá tham chiếu, cửa khẩu phù hợp
9. Áp dụng Tư duy 3 tầng → so sánh tối thiểu 3 mã
10. Trả lời ĐÚNG FORMAT OUTPUT trong system prompt (bắt buộc)

CHÚ Ý QUAN TRỌNG:
- Thuế suất PHẢI lấy từ fact_layer — KHÔNG ĐƯỢC tự bịa số
- Nếu fact_layer không có thuế → ghi "Chưa có dữ liệu, cần xác minh"
- Chú giải 2022 ưu tiên hơn 2017 — trích SEN nếu có
- TB-TCHQ nếu có → trích dẫn đầy đủ số hiệu, năm, lý do — KHÔNG chốt mã nếu chưa kiểm tra
- regulatory_layer: nếu hàng cần giấy phép/kiểm dịch → CẢNH BÁO rõ ràng
- logistics_layer: nếu có giá tham chiếu → ghi nhận để user biết mức giá HQ theo dõi
- Mặc định xuất xứ Trung Quốc → phân tích ACFTA. Nếu user nói xuất xứ khác → dùng FTA phù hợp
- Phải dựa trên DỮ LIỆU API ở trên, KHÔNG dùng kiến thức riêng cho thuế suất
- LUÔN đưa ra bảng so sánh ≥3 mã HS để user chọn — KHÔNG hỏi ngược "bạn cho biết thêm"
- Nếu nhiều mã tiềm năng → liệt kê TẤT CẢ kèm điều kiện phù hợp, để user tự chọn
- Mọi kết luận phải có lập luận đủ giải trình trước Hải quan — trích dẫn nguồn bắt buộc
- Cuối response, gợi ý: "Chọn mã phù hợp nhất để tôi phân tích chi tiết hơn"`;
  } else {
    // === BƯỚC 4b: Fallback — mở rộng search theo chương liên quan ===
    // Thay vì hỏi user, chủ động tìm các chương có thể liên quan
    const fallbackChapters = await guessFallbackChapters(keywords, message, apiKey);
    let fallbackResults = [];

    if (fallbackChapters.length > 0) {
      const chapterResults = await Promise.allSettled(
        fallbackChapters.slice(0, 3).map(async (ch) => {
          apiLog.push({ step: 'fallback_chapter', chapter: ch.chapter, keyword: ch.keyword, status: 'calling' });
          try {
            // Dùng getChapter() nếu có số chương, fallback sang searchHS
            let items = [];
            if (ch.chapter) {
              const chapterData = await getChapter(ch.chapter);
              items = (chapterData?.items || chapterData?.results || []).slice(0, 20);
              // Filter by keyword relevance within chapter
              if (ch.keyword && items.length > 10) {
                const kw = ch.keyword.toLowerCase();
                const filtered = items.filter(i =>
                  (i.vn || i.ten_vn || i.mo_ta || '').toLowerCase().includes(kw) ||
                  (i.en || i.ten_en || '').toLowerCase().includes(kw)
                );
                if (filtered.length >= 3) items = filtered;
              }
            }
            // Fallback: keyword search nếu getChapter trả rỗng
            if (items.length === 0 && ch.keyword) {
              const data = await searchHS(ch.keyword, 15);
              const parsed = parseSearchResults(data);
              items = parsed.all;
            }
            apiLog.push({ step: 'fallback_chapter', chapter: ch.chapter, status: 'done', resultCount: items.length });
            return items.map(i => ({ ...i, _source: `chapter_${ch.chapter}` }));
          } catch (e) {
            apiLog.push({ step: 'fallback_chapter', chapter: ch.chapter, status: 'error', error: e.message });
            return [];
          }
        })
      );
      for (const r of chapterResults) {
        if (r.status === 'fulfilled') fallbackResults.push(...r.value);
      }
    }

    const fallbackContext = fallbackResults.length > 0
      ? `\nKẾT QUẢ TÌM MỞ RỘNG (${fallbackResults.length} mã tiềm năng):\n${JSON.stringify(
          fallbackResults.slice(0, 15).map(r => ({
            hs: r.hs || r.ma_hs || r.hs_code,
            vn: r.vn || r.ten_vn || r.mo_ta,
            en: r.en || r.ten_en,
            _source: r._source,
          })), null, 2)}`
      : '';

    analysisPrompt = `${SYSTEM_PROMPT}
${historyText}
Người dùng hỏi: "${message || '(xem file đính kèm)'}"${fileInfo}

Từ khóa đã thử: ${JSON.stringify(keywords)}
Tìm kiếm chính xác trả 0 kết quả. Đã mở rộng tìm kiếm theo chương liên quan.
${fallbackContext}

BẮT BUỘC — KHÔNG ĐƯỢC hỏi user cung cấp thêm thông tin mà chưa đưa ra kết quả.
Thay vào đó:
1. Phân tích sản phẩm từ mô tả/file — xác định nhóm hàng có thể thuộc
2. Liệt kê TẤT CẢ mã HS tiềm năng (≥3 mã) dạng bảng so sánh để user CHỌN:
   | STT | Mã HS | Mô tả | Phù hợp nếu... | Thuế MFN |
3. Với mỗi mã, giải thích ĐIỀU KIỆN nào thì phù hợp (vật liệu, chức năng, kích thước...)
4. Gợi ý user: "Sản phẩm của bạn gần nhất với mã nào? Chọn số thứ tự để tôi phân tích chi tiết"
5. Nếu thực sự không đủ dữ liệu → vẫn đưa ra 2-3 chương có thể, kèm ví dụ mã HS trong mỗi chương

KHÔNG BAO GIỜ trả lời chỉ với "bạn cho biết thêm" mà không kèm danh sách gợi ý.
Trả lời bằng tiếng Việt, thân thiện, chuyên nghiệp.`;
  }

  apiLog.push({ step: 'llm_analysis', status: 'calling' });
  let analysis;
  try {
    analysis = await callLLM(analysisPrompt, apiKey, { file, model: MODELS.HEAVY });
    apiLog[apiLog.length - 1] = { step: 'llm_analysis', status: 'done' };
  } catch (llmError) {
    apiLog[apiLog.length - 1] = { step: 'llm_analysis', status: 'error', error: llmError.message };
    // LLM analysis failed — build a basic response from raw search data
    if (hasData) {
      const codeList = allResults.slice(0, 10).map(r => {
        const hs = r.hs || r.ma_hs || r.hs_code || '';
        const vn = r.vn || r.ten_vn || r.mo_ta || '';
        return `| ${hs} | ${vn} |`;
      }).join('\n');
      analysis = `**Kết quả tra cứu cho "${message}"**\n\nTìm thấy ${allResults.length} mã HS tiềm năng:\n\n| Mã HS | Mô tả |\n|-------|-------|\n${codeList}\n\n*Lưu ý: Phân tích chi tiết tạm thời không khả dụng. Vui lòng chọn mã HS cần xem chi tiết thuế suất.*`;
    } else {
      analysis = `Đã tìm kiếm "${message}" nhưng chưa tìm thấy mã HS phù hợp. Vui lòng mô tả chi tiết hơn về hàng hóa (vật liệu, chức năng, công dụng).`;
    }
  }

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
