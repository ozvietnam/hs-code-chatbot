# GỢI Ý NÂNG CẤP: Tối ưu tốc độ — Parallelise API + Cache

> Ngày tạo: 2026-04-05
> Trạng thái: Chờ dev triển khai
> Độ ưu tiên: P0 — Giảm 2-4 giây/request, hiệu quả hơn nhiều key

---

## Vấn đề hiện tại

Customs agent gọi API **tuần tự** — mỗi call chờ cái trước xong:
```
searchHS("cảm biến")     → 400ms  ─┐
searchHS("cảm biến từ")  → 400ms  ─┤ Tuần tự = 1200ms
searchHS("sensor")        → 400ms  ─┘

getHSDetail("85334000")  → 500ms  ─┐
getHSDetail("90318000")  → 500ms  ─┤ Tuần tự = 2500ms
getHSDetail("85365000")  → 500ms  ─┤
getHSDetail("84818000")  → 500ms  ─┤
getHSDetail("90328900")  → 500ms  ─┘
```
**Tổng chờ không cần thiết: ~3700ms** (có thể giảm còn ~900ms)

---

## Phần A: Parallelise API Calls

### A1. Search Keywords song song trong mỗi Tier

**File:** `lib/agents/customsAgent.js` — function `smartSearch()`

**Hiện tại (dòng 58-90):**
```javascript
// TIER 1 — tuần tự, chậm
for (const kw of (keywords.primary || []).slice(0, 3)) {
  const data = await searchHS(kw, 10);  // chờ từng cái
  // ...
}
```

**Đề xuất:**
```javascript
// TIER 1 — song song, nhanh 3x
const tier1Results = await Promise.allSettled(
  (keywords.primary || []).slice(0, 3).map(async (kw) => {
    apiLog.push({ step: 'search_t1_primary', keyword: kw, status: 'calling' });
    try {
      const data = await searchHS(kw, 10);
      const parsed = parseSearchResults(data);
      apiLog.push({ step: 'search_t1_primary', keyword: kw, status: 'done', resultCount: parsed.all.length });
      return parsed;
    } catch (e) {
      apiLog.push({ step: 'search_t1_primary', keyword: kw, status: 'error', error: e.message });
      return { sources: {}, all: [] };
    }
  })
);

// Merge results
for (const r of tier1Results) {
  if (r.status === 'fulfilled' && r.value) {
    mergeResults(searchSources, r.value.sources);
    allResults.push(...r.value.all);
  }
}
if (allResults.length > 0) strategy = 'tier1_primary';
```

**Áp dụng tương tự cho Tier 2, 3, 4.** Logic tier cascade (chỉ chạy tier sau nếu <3 results) giữ nguyên.

**Tiết kiệm:** 3 keywords × 400ms tuần tự = 1200ms → song song = 400ms → **tiết kiệm 800ms**

---

### A2. getHSDetail song song cho top mã HS

**File:** `lib/agents/customsAgent.js` — dòng 211-222

**Hiện tại:**
```javascript
for (const code of codesToFetch.slice(0, 5)) {
  const detail = await getHSDetail(code);  // chờ từng cái
  // ...
}
```

**Đề xuất:**
```javascript
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

hsDetails.push(...detailResults
  .filter(r => r.status === 'fulfilled' && r.value)
  .map(r => r.value)
);
```

**Tiết kiệm:** 5 codes × 500ms = 2500ms → song song = 500ms → **tiết kiệm 2000ms**

---

### A3. Cron jobs song song (extract + review)

**File:** `pages/api/cron/extract.js`

**Hiện tại:** 10 sessions xử lý tuần tự
**Đề xuất:** Batch 3 sessions cùng lúc

```javascript
const BATCH_SIZE = 3;
for (let i = 0; i < eligibleSessions.length; i += BATCH_SIZE) {
  const batch = eligibleSessions.slice(i, i + BATCH_SIZE);
  const batchResults = await Promise.allSettled(
    batch.map(session => processOneSession(session, apiKey))
  );
  // collect results...
}
```

**File:** `pages/api/cron/review.js` — tương tự, batch 3 proposals cùng lúc.

**Tiết kiệm:** Cron chạy nhanh 50-70%, nhưng không ảnh hưởng user (async).

---

### Tổng tiết kiệm Parallelise

| Điểm song song | Trước | Sau | Tiết kiệm |
|---|---|---|---|
| Search keywords (Tier 1) | 1200ms | 400ms | **800ms** |
| Search keywords (Tier 2-4) | 800ms | 400ms | **400ms** |
| getHSDetail (5 codes) | 2500ms | 500ms | **2000ms** |
| **Tổng/request** | **~4500ms** | **~1300ms** | **~3200ms (71%)** |

---

## Phần B: Cache API Response

### B1. Cache getHSDetail trong memory (đơn giản nhất)

**File:** `lib/hsApi.js`

**Thêm in-memory cache với TTL 1 giờ:**

```javascript
const BASE_URL = 'https://hs-knowledge-api.vercel.app';

// Simple in-memory cache (TTL 1 hour)
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  // Limit cache size to 500 entries
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, time: Date.now() });
}

export async function getHSDetail(hsCode, fields) {
  const cacheKey = `hs:${hsCode}:${fields || 'all'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let url = `${BASE_URL}/api/hs?hs=${encodeURIComponent(hsCode)}`;
  if (fields) url += `&fields=${encodeURIComponent(fields)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HS detail failed: ${res.status}`);
  const data = await res.json();

  setCache(cacheKey, data);
  return data;
}

export async function searchHS(query, limit = 10) {
  const cacheKey = `search:${query}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();

  setCache(cacheKey, data);
  return data;
}
```

**Hiệu quả:**
- Request đầu: gọi API bình thường
- Request sau (cùng mã HS trong 1 giờ): **0ms** thay vì 500ms
- Serverless function restart → cache reset (chấp nhận được)

### B2. Cache qua Vercel KV (optional, phase sau)

Nếu muốn cache persist giữa function restarts:
```javascript
import { kv } from '@vercel/kv';

// TTL 24h, dữ liệu HS ít thay đổi
await kv.set(`hs_cache:${hsCode}`, data, { ex: 86400 });
const cached = await kv.get(`hs_cache:${hsCode}`);
```

---

## Phần C: Tại sao KHÔNG nên dùng nhiều Groq keys

| Phương án | Hiệu quả | Rủi ro | Khuyến nghị |
|---|---|---|---|
| **Parallelise API** | Giảm 3200ms/request | Không | ✅ Làm ngay |
| **Phân model (8B/17B/70B)** | Phân tán TPM, nhanh 5-10x cho task nhỏ | Không | ✅ Làm ngay |
| **Cache response** | Giảm 50-70% API calls | Không | ✅ Làm ngay |
| **Nhiều Groq keys** | Tăng TPM pool | Vi phạm ToS, risk ban | ❌ Không khuyến nghị |
| **Groq paid tier** | TPM không giới hạn | Chi phí | 🟡 Chỉ khi cần scale |
| **Thêm provider backup** | Failover khi Groq down | Thêm complexity | 🟡 Phase sau |

**Kết luận:** 3 giải pháp đầu (parallelise + model + cache) giải quyết 95% vấn đề tốc độ mà không cần nhiều key.

---

## Thứ tự triển khai khuyến nghị

| Bước | Task | File | Effort | Impact |
|---|---|---|---|---|
| 1 | Parallelise search trong smartSearch() | `customsAgent.js` | 1 giờ | **-800ms** |
| 2 | Parallelise getHSDetail() | `customsAgent.js` | 30 phút | **-2000ms** |
| 3 | Thêm in-memory cache | `hsApi.js` | 30 phút | **-50% API calls** |
| 4 | Phân model per agent | 7 files (xem plan riêng) | 1 giờ | **-TPM pressure** |
| 5 | Parallelise cron jobs | `extract.js`, `review.js` | 30 phút | **-60% cron time** |

**Tổng effort: ~3.5 giờ** cho toàn bộ optimisation.

---

## An toàn khi Parallelise

| Concern | Trả lời |
|---|---|
| `searchHS()` có shared state? | **Không** — pure fetch, stateless |
| `getHSDetail()` có shared state? | **Không** — pure fetch, stateless |
| `apiLog` array bị race condition? | **Có thể** — dùng `.push()` riêng cho mỗi call, merge sau |
| HS Knowledge API chịu được parallel? | **Có** — static JSON serve, không DB query |
| Groq rate limit khi parallel LLM calls? | **Chỉ ảnh hưởng nếu gọi nhiều LLM cùng lúc** — API calls song song không ảnh hưởng |

---

## Xem thêm

- [UPGRADE-PLAN-MODEL-PER-AGENT.md](./UPGRADE-PLAN-MODEL-PER-AGENT.md) — Phân bổ model 8B/17B/70B
- [REVIEW-DATA-LIFECYCLE.md](../REVIEW-DATA-LIFECYCLE.md) — Review vòng đời data
