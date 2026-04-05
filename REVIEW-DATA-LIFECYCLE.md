# REVIEW: Vòng đời Data — HS Code VN Chatbot
> Ngày review: 2026-04-05 | Reviewer: Claude Code

---

## 1. KIẾN TRÚC HIỆN TẠI

```
USER ──→ Router ──→ Agent ──→ HS Knowledge API (9 tầng) ──→ LLM ──→ Response
           │                         ↑ (stateless)                      │
           │                         │                                  │
           │                   lib/hsApi.js                             │
           │                                                            │
           ▼                                                            ▼
     Intent Classify                                          Session Store (KV)
     (4 loại agent)                                              TTL: 24h
                                                                    │
                                                                    ▼
                                                          Extractor (cron 6h)
                                                                    │
                                                                    ▼
                                                          Librarian Review
                                                                    │
                                                                    ▼
                                                          Knowledge Store (Postgres)
                                                                    │
                                                                    ✖ KHÔNG QUAY LẠI AGENT
```

**Vấn đề cốt lõi:** Vòng đời data bị HỞ — dữ liệu đúc kết xong không được tái sử dụng.

---

## 2. PHÁT HIỆN CHÍNH

### 2.1 — Knowledge Store có nhưng KHÔNG AI DÙNG (Nghiêm trọng)

**Hiện trạng:**
- `lib/stores/knowledgeStore.js` đã build đầy đủ: `addKnowledgeItem()`, `searchByHSCodes()`, `searchByContent()`, `trackUsage()`
- Cron extract + librarian review hoạt động → insights được lưu vào Postgres
- Nhưng `customsAgent.js` KHÔNG GỌI `knowledgeStore` ở bất kỳ đâu

**Hậu quả:**
- Mỗi query giống nhau xử lý lại từ đầu
- Insights đúc kết (hs_insight, confusion, precedent) nằm chết trong DB
- Hệ thống không thông minh hơn theo thời gian

**Khuyến nghị:**
- Thêm bước "KB Lookup" vào customsAgent trước khi gọi LLM phân tích
- Ưu tiên KB insights có `used_count` cao và `confidence >= 0.8`
- Merge KB data vào context prompt cùng với API data

---

### 2.2 — Không có Feedback Loop từ User (Nghiêm trọng)

**Hiện trạng:**
- User nhận kết quả → không có cách đánh giá đúng/sai
- Không có nút thumbs up/down, rating, hay correction
- Extractor chỉ đoán insight từ conversation, không biết accuracy

**Hậu quả:**
- Không phân biệt được insight tốt vs insight sai
- Librarian review dựa trên LLM đánh giá LLM → thiếu ground truth
- Không thể đo chất lượng hệ thống

**Khuyến nghị:**
- Thêm UI feedback (👍/👎) sau mỗi response
- Lưu feedback vào session metadata
- Extractor ưu tiên session có feedback positive
- Tạo bảng `feedback_items` riêng để track accuracy theo thời gian

---

### 2.3 — Không Cache API Response (Trung bình)

**Hiện trạng:**
- Mỗi request gọi HS Knowledge API mới hoàn toàn
- Cùng mã HS 85334000 hỏi 100 lần = 100 lần gọi `/api/hs`
- Không có cache layer nào (memory, Redis, hay file)

**Hậu quả:**
- Lãng phí bandwidth và latency
- HS API có thể bị rate limit khi traffic cao
- Tăng thời gian response không cần thiết

**Khuyến nghị:**
- Cache getHSDetail() trong Vercel KV với TTL 24h (dữ liệu HS ít thay đổi)
- Cache key: `hs_cache:{mã_hs}` → value: 9-layer JSON
- Invalidate khi HS API data update (webhook hoặc daily refresh)

---

### 2.4 — Session History quá ngắn (Trung bình)

**Hiện trạng:**
- Messages: TTL 24h → xóa sạch
- Metadata: TTL 7 ngày → xóa sạch
- Không có long-term storage cho conversation analytics

**Hậu quả:**
- Không thể phân tích trend (mã HS nào hay bị hỏi, mùa nào traffic tăng)
- Mất dữ liệu training quý giá
- Không thể replay conversation để debug

**Khuyến nghị:**
- Giữ TTL ngắn cho KV (tốt cho performance)
- Thêm pipeline archive: trước khi session hết hạn → lưu summary vào Postgres
- Bảng `session_archive`: session_id, hs_codes_asked, agent_used, feedback, timestamp

---

### 2.5 — Dữ liệu tĩnh không có Version Control (Nhẹ)

**Hiện trạng:**
- `faq.json` (6 entries), `pricing.json`, `regulations.json` — sửa tay trong repo
- Không có `updated_by`, `version`, hay changelog
- `pricing.json` có field `updated: "2026-04-01"` nhưng không enforce

**Khuyến nghị:**
- Thêm field `version` và `updated_at` cho tất cả JSON data files
- Hoặc chuyển sang admin API endpoint để quản lý (phase sau)

---

### 2.6 — Không có Analytics/Monitoring (Nhẹ)

**Hiện trạng:**
- Debug panel ở frontend chỉ hiện per-request
- Không aggregate: "tuần này có bao nhiêu query", "mã nào hay fail"
- Không track: latency, error rate, agent usage distribution

**Khuyến nghị:**
- Bảng `analytics_events`: event_type, agent, hs_code, latency_ms, success, timestamp
- Dashboard đơn giản (hoặc export CSV cho manual analysis)
- Alert khi error rate > threshold

---

## 3. MA TRẬN ƯU TIÊN

| # | Phát hiện | Mức độ | Effort | Ưu tiên |
|---|-----------|--------|--------|---------|
| 2.1 | KB không được sử dụng lại | 🔴 Cao | Medium (2-3 ngày) | **P0** |
| 2.2 | Không feedback loop | 🔴 Cao | Medium (2-3 ngày) | **P0** |
| 2.3 | Không cache API | 🟡 TB | Low (1 ngày) | **P1** |
| 2.4 | Session TTL quá ngắn | 🟡 TB | Low (1 ngày) | **P1** |
| 2.5 | Data tĩnh không version | 🟢 Nhẹ | Low (0.5 ngày) | **P2** |
| 2.6 | Không analytics | 🟢 Nhẹ | Medium (2 ngày) | **P2** |

---

## 4. VÒNG ĐỜI DATA LÝ TƯỞNG (Đề xuất)

```
         ┌──────────────── KB Insights ─────────────────┐
         │                                              │
         ▼                                              │
USER ──→ Agent ──→ HS API + KB Lookup ──→ LLM ──→ Response
                        ↑ (cached)              │       │
                        │                       │       │
                    API Cache (KV)              │    Feedback 👍👎
                                                │       │
                                                ▼       ▼
                                          Session Store + Feedback
                                                │
                                                ▼
                                        Extract Insights
                                        (ưu tiên session có 👍)
                                                │
                                                ▼
                                        Librarian Review
                                                │
                                                ▼
                                        Knowledge Store ────────┘
                                        (tái sử dụng ✅)
                                                │
                                                ▼
                                        Analytics Archive
```

**3 thay đổi khép kín vòng:**
1. **KB → Agent:** Customs Agent query KB trước khi phân tích
2. **User → Feedback:** Thêm 👍👎 → weight cho extraction
3. **API → Cache:** Giảm latency, giảm API calls

---

## 5. FILES LIÊN QUAN

| File | Vai trò | Cần sửa |
|------|---------|---------|
| `lib/agents/customsAgent.js` | Agent chính | Thêm KB lookup |
| `lib/stores/knowledgeStore.js` | KB storage | Đã sẵn sàng, chỉ cần gọi |
| `lib/stores/sessionStore.js` | Session + feedback | Thêm feedback field |
| `components/ChatUI.js` | UI | Thêm nút feedback |
| `pages/api/chat.js` | Dispatcher | Thêm feedback endpoint |
| `pages/api/cron/extract.js` | Extraction | Ưu tiên session có feedback |
| `lib/hsApi.js` | API client | Thêm cache layer |

---

## 6. GHI CHÚ KỸ THUẬT

- **LLM hiện tại:** Llama 3.3 70B qua Groq (miễn phí, OpenAI-compatible)
- **Storage:** Vercel KV (Redis) cho session, Vercel Postgres cho KB
- **Deploy:** Vercel (Next.js 14, serverless functions)
- **HS Knowledge API:** Riêng biệt tại `hs-knowledge-api.vercel.app` (11,871 mã HS, 97 chương)
- **Agents:** 4 agents (customs, care, pricing, regulation) + router + extractor + librarian
