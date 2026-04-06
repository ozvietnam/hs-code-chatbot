const BASE_URL = 'https://hs-knowledge-api.vercel.app';

// ==================== In-memory cache (TTL 1 hour) ====================
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE = 500;

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
  if (cache.size >= MAX_CACHE) {
    // Evict oldest entry
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, time: Date.now() });
}

// ==================== API Functions ====================

/**
 * Tìm kiếm mã HS theo từ khóa (cached)
 */
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

/**
 * Lấy đầy đủ 9 tầng dữ liệu cho 1 mã HS (cached)
 */
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

/**
 * Lấy toàn bộ mã HS trong 1 chương (cached)
 */
export async function getChapter(chapter) {
  const cacheKey = `chapter:${chapter}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/chapter?chapter=${chapter}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chapter failed: ${res.status}`);
  const data = await res.json();

  setCache(cacheKey, data);
  return data;
}

/**
 * Lấy dữ liệu KTCN (kiểm tra chuyên ngành) cho 1 mã HS (cached)
 * Trả về: co_quan quản lý, loại KTCN, văn bản pháp lý, thủ tục, lưu ý
 */
export async function getKTCN(hsCode) {
  const cacheKey = `ktcn:${hsCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/kg_ktcn?hs=${encodeURIComponent(hsCode)}`;
  const res = await fetch(url);
  if (!res.ok) return null; // No KTCN data is not an error
  const data = await res.json();

  if (data.found) {
    setCache(cacheKey, data);
    return data;
  }
  return null;
}
