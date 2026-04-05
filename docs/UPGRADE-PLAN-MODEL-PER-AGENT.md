# GỢI Ý NÂNG CẤP: Phân bổ Model API tối ưu cho từng Agent

> Ngày tạo: 2026-04-05
> Trạng thái: Chờ dev triển khai
> Độ ưu tiên: P1 — Giảm chi phí + tránh rate limit

---

## Vấn đề hiện tại

Hệ thống dùng **1 model duy nhất** (`llama-3.3-70b-versatile`) cho TẤT CẢ 7 agents:
- **Lãng phí:** Router classify intent chỉ cần JSON 20 tokens nhưng dùng model 70B
- **Rate limit:** Groq free tier giới hạn TPM cho 70B → customs agent 15K+ tokens dễ bị chặn
- **Chậm:** Care agent trả lời "xin chào" phải chờ model 70B inference

---

## Giải pháp: 3 tầng Model

```
┌─── 8B FAST (llama-3.1-8b-instant) ────────────────┐
│  Router (classify intent)         ~1K tokens       │
│  Customs (extract keyword)        ~2.5K tokens     │
│  Care (greeting/FAQ)              ~2K tokens       │
│  Extractor (cron, async)          ~3K tokens       │
│  → Nhanh gấp 5-10x, TPM pool riêng               │
└────────────────────────────────────────────────────┘

┌─── 17B MEDIUM (llama-4-scout-17b-16e-instruct) ───┐
│  Pricing (bảng giá)               ~2K tokens       │
│  Librarian (review KB, async)     ~1.5K tokens     │
│  → Cân bằng chất lượng/tốc độ                     │
└────────────────────────────────────────────────────┘

┌─── 70B HEAVY (llama-3.3-70b-versatile) ────────────┐
│  Customs (analysis 9 tầng)        ~12K tokens      │
│  Regulation (pháp lý)             ~6K tokens       │
│  → CHỈ 2 agent cần 70B → TPM an toàn              │
└────────────────────────────────────────────────────┘
```

---

## Bảng phân bổ chi tiết

| Agent | Task | Model hiện tại | Model đề xuất | Lý do |
|---|---|---|---|---|
| **Router** | Classify intent → JSON | 70B (lãng phí) | **8B** | JSON 20 tokens, keyword rules xử lý ~80% trước LLM |
| **Customs (extract)** | Trích keyword → JSON | 70B (lãng phí) | **8B** | Keyword extraction đơn giản, không cần reasoning |
| **Customs (analysis)** | Phân tích 9 tầng HS | 70B (phù hợp) | **70B** ✅ | Task phức tạp nhất: so sánh 3+ mã, trích dẫn pháp lý |
| **Care** | Chào hỏi, FAQ | 70B (lãng phí) | **8B** | Conversational đơn giản, không cần reasoning |
| **Pricing** | Bảng giá dịch vụ | 70B (hợp lý) | **17B** | Format bảng từ pricing.json, logic đơn giản |
| **Regulation** | Giải thích pháp luật | 70B (phù hợp) | **70B** ✅ | Cần reasoning + trích dẫn điều khoản chính xác |
| **Extractor** | Trích insight (cron) | 70B (lãng phí) | **8B** | Async, Librarian sẽ review sau |
| **Librarian** | Review insight (cron) | 70B (lãng phí) | **17B** | 70% auto-rules, chỉ 30% cần LLM |

---

## Token tiết kiệm

### Trước (tất cả 70B)
```
1 customs request:
  Router:     ~1,000 tokens × 70B
  Extract:    ~2,500 tokens × 70B
  Analysis:  ~12,000 tokens × 70B
  ─────────────────────────────────
  TOTAL:     ~15,500 tokens trên 70B pool → BỊ RATE LIMIT
```

### Sau (phân tán)
```
1 customs request:
  Router:     ~1,000 tokens × 8B   (pool riêng)
  Extract:    ~2,500 tokens × 8B   (pool riêng)
  Analysis:  ~12,000 tokens × 70B  (chỉ 1 call)
  ─────────────────────────────────
  70B chỉ dùng 12K (giảm 23%) → KHÔNG BỊ CHẶN
```

---

## Hướng dẫn triển khai

### Bước 1: Thêm model constants vào `lib/agents/shared.js`

```javascript
// Thêm sau dòng import, trước callLLM()
export const MODELS = {
  FAST:   process.env.LLM_MODEL_FAST   || 'llama-3.1-8b-instant',
  MEDIUM: process.env.LLM_MODEL_MEDIUM || 'meta-llama/llama-4-scout-17b-16e-instruct',
  HEAVY:  process.env.LLM_MODEL_HEAVY  || 'llama-3.3-70b-versatile',
};
```

### Bước 2: Thêm env vars vào `.env.local`

```bash
# Thêm (optional, có default trong code)
LLM_MODEL_FAST=llama-3.1-8b-instant
LLM_MODEL_MEDIUM=meta-llama/llama-4-scout-17b-16e-instruct
LLM_MODEL_HEAVY=llama-3.3-70b-versatile
```

### Bước 3: Override model ở từng agent

**router.js:**
```javascript
import { callLLM, MODELS } from './shared';
// ...
const raw = await callLLM(prompt, apiKey, {
  temperature: 0.1, maxTokens: 100,
  model: MODELS.FAST
});
```

**customsAgent.js:**
```javascript
import { callLLM, MODELS, formatHistory } from './shared';
// ...
// Extraction (dòng ~228):
const keywordsRaw = await callLLM(extractPrompt, apiKey, {
  file,
  model: MODELS.FAST
});

// Analysis (dòng ~352):
const analysis = await callLLM(analysisPrompt, apiKey, {
  file,
  model: MODELS.HEAVY
});
```

**careAgent.js:**
```javascript
import { callLLM, MODELS, formatHistory } from './shared';
// ...
const reply = await callLLM(prompt, apiKey, {
  temperature: 0.5, maxTokens: 2048,
  model: MODELS.FAST
});
```

**pricingAgent.js:**
```javascript
import { callLLM, MODELS, formatHistory } from './shared';
// ...
const reply = await callLLM(prompt, apiKey, {
  temperature: 0.1, maxTokens: 4096,
  model: MODELS.MEDIUM
});
```

**regulationAgent.js:**
```javascript
// Không cần override — mặc định đã là HEAVY (70B)
```

**extractorAgent.js:**
```javascript
import { callLLM, MODELS } from './shared';
// ...
const raw = await callLLM(prompt, apiKey, {
  temperature: 0.1, maxTokens: 2048,
  model: MODELS.FAST
});
```

**librarianAgent.js:**
```javascript
import { callLLM, MODELS } from './shared';
// ...
const raw = await callLLM(reviewPrompt, apiKey, {
  temperature: 0.1, maxTokens: 512,
  model: MODELS.MEDIUM
});
```

### Bước 4: Cập nhật Vercel Environment Variables

Thêm 3 env vars (optional nhưng cho flexibility):
- `LLM_MODEL_FAST` = `llama-3.1-8b-instant`
- `LLM_MODEL_MEDIUM` = `meta-llama/llama-4-scout-17b-16e-instruct`
- `LLM_MODEL_HEAVY` = `llama-3.3-70b-versatile`

---

## Test Plan

| # | Test | Input | Verify |
|---|---|---|---|
| 1 | Router classify | "cảm biến từ" | intent=customs, debug hiện model 8B |
| 2 | Router classify | "xin chào" | intent=care, debug hiện model 8B |
| 3 | Router classify | "báo giá khai báo" | intent=pricing, model 8B |
| 4 | Customs full | "ốc vít thép không gỉ M8" | Keywords extracted (8B), analysis đầy đủ (70B) |
| 5 | Care response | "chatbot này làm gì" | Response nhanh, tự nhiên (8B) |
| 6 | Pricing response | "giá dịch vụ thông quan" | Bảng giá đúng format (17B) |
| 7 | Rate limit | 5 customs queries liên tục | Không bị TPM block |

---

## Rủi ro

| Rủi ro | Mitigation |
|---|---|
| 8B extract keyword kém cho Vietnamese | Keyword rules (regex) xử lý trước LLM. Test 20 queries trước deploy. |
| 17B pricing format sai bảng | Pricing data cố định trong JSON, LLM chỉ format. |
| Groq thay đổi models | Dùng env vars → đổi model không cần sửa code. |

---

## Files cần sửa

| File | Thay đổi | LOC |
|---|---|---|
| `lib/agents/shared.js` | Thêm `MODELS` export | +5 |
| `lib/agents/router.js` | Import MODELS, thêm model override | +2 |
| `lib/agents/customsAgent.js` | Import MODELS, override extract + analysis | +3 |
| `lib/agents/careAgent.js` | Import MODELS, override model | +2 |
| `lib/agents/pricingAgent.js` | Import MODELS, override model | +2 |
| `lib/agents/extractorAgent.js` | Import MODELS, override model | +2 |
| `lib/agents/librarianAgent.js` | Import MODELS, override model | +2 |
| `.env.local` | Thêm 3 model aliases | +3 |
| **Tổng** | | **~21 dòng** |
