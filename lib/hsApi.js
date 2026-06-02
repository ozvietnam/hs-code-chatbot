const BASE_URL = 'https://hs-knowledge-api.vercel.app';

// ==================== Redis + Memory Cache (TTL 1 hour) ====================
// WS-003: Persistent cache across redeploys using Upstash Redis + fallback to in-memory
const CACHE_TTL = 60 * 60 * 1000; // 1 hour (in ms)
const CACHE_TTL_SECONDS = 3600; // 1 hour (in seconds for Redis)
const MAX_MEMORY_CACHE = 500;

const memoryCache = new Map();
let redisClient = null;
let redisChecked = false;

// Cache instrumentation for WS-003 verification
const cacheStats = {
  hits: 0,
  misses: 0,
  redisHits: 0,
  redisErrors: 0,
  memoryHits: 0,
  resetTime: new Date().toISOString(),
};

// Initialize Redis connection (if available)
function getRedis() {
  if (redisChecked) return redisClient;
  redisChecked = true;
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const { Redis } = require('@upstash/redis');
      redisClient = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
    }
  } catch (err) {
    console.warn('[hsApi] Redis initialization failed:', err.message);
    redisClient = null;
  }
  return redisClient;
}

// Get from cache (Redis primary, fallback to memory)
async function getCached(key) {
  const redis = getRedis();

  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get(`hs:${key}`);
      if (cached) {
        cacheStats.hits++;
        cacheStats.redisHits++;
        return cached;
      }
    } catch (err) {
      console.warn(`[hsApi] Redis get failed for ${key}:`, err.message);
      cacheStats.redisErrors++;
    }
  }

  // Fallback to memory
  const entry = memoryCache.get(key);
  if (!entry) {
    cacheStats.misses++;
    return null;
  }
  if (Date.now() - entry.time > CACHE_TTL) {
    memoryCache.delete(key);
    cacheStats.misses++;
    return null;
  }
  cacheStats.hits++;
  cacheStats.memoryHits++;
  return entry.data;
}

// Set cache (Redis + Memory)
async function setCache(key, data) {
  const redis = getRedis();

  // Save to Redis
  if (redis) {
    try {
      await redis.set(`hs:${key}`, data, { ex: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn(`[hsApi] Redis set failed for ${key}:`, err.message);
    }
  }

  // Save to memory (local performance + fallback)
  if (memoryCache.size >= MAX_MEMORY_CACHE) {
    // Evict oldest entry using FIFO
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, { data, time: Date.now() });
}

// ==================== API Functions ====================

/**
 * Tìm kiếm mã HS theo từ khóa (cached with Redis fallback)
 */
export async function searchHS(query, limit = 10) {
  const cacheKey = `search:${query}:${limit}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();

  await setCache(cacheKey, data);
  return data;
}

/**
 * Lấy đầy đủ 9 tầng dữ liệu cho 1 mã HS (cached)
 */
export async function getHSDetail(hsCode, fields) {
  const cacheKey = `hs:${hsCode}:${fields || 'all'}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  let url = `${BASE_URL}/api/hs?hs=${encodeURIComponent(hsCode)}`;
  if (fields) url += `&fields=${encodeURIComponent(fields)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HS detail failed: ${res.status}`);
  const data = await res.json();

  await setCache(cacheKey, data);
  return data;
}

/**
 * Lấy toàn bộ mã HS trong 1 chương (cached)
 */
export async function getChapter(chapter) {
  const cacheKey = `chapter:${chapter}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/chapter?chapter=${chapter}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chapter failed: ${res.status}`);
  const data = await res.json();

  await setCache(cacheKey, data);
  return data;
}

/**
 * Lấy dữ liệu KTCN (kiểm tra chuyên ngành) cho 1 mã HS (cached)
 * Trả về: co_quan quản lý, loại KTCN, văn bản pháp lý, thủ tục, lưu ý
 */
export async function getKTCN(hsCode) {
  const cacheKey = `ktcn:${hsCode}`;
  const cached = await getCached(cacheKey);
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

// ==================== Precedent Layer (TB-TCHQ) ====================

/**
 * Lấy tiền lệ TB-TCHQ theo số TB (cached)
 * @param {string} soHieu - Số TB (e.g., "1238/TB-TCHQ")
 * @returns {Object} TB-TCHQ record với đầy đủ 9 layers
 */
export async function getPrecedentBySoHieu(soHieu) {
  const cacheKey = `precedent:so_hieu:${soHieu}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/precedent?so_hieu=${encodeURIComponent(soHieu)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  if (data.found) {
    setCache(cacheKey, data);
    return data;
  }
  return null;
}

/**
 * Lấy tất cả TB-TCHQ cho 1 mã HS (cached)
 * @param {string} hsCode - Mã HS (e.g., "87046029" hoặc "8704.60.29")
 * @returns {Object} Danh sách TB-TCHQ liên quan
 */
export async function getPrecedentByHSCode(hsCode) {
  const cacheKey = `precedent:hs:${hsCode}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/precedent?hs=${encodeURIComponent(hsCode)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  if (data.found) {
    setCache(cacheKey, data);
    return data;
  }
  return null;
}

/**
 * Tìm kiếm TB-TCHQ theo doanh nghiệp (cached)
 * @param {string} enterpriseName - Tên doanh nghiệp
 * @returns {Object} Danh sách TB liên quan
 */
export async function searchPrecedentByEnterprise(enterpriseName) {
  const cacheKey = `precedent:enterprise:${enterpriseName}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/precedent?enterprise=${encodeURIComponent(enterpriseName)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  if (data.found) {
    setCache(cacheKey, data);
    return data;
  }
  return null;
}

/**
 * Lấy thống kê TB-TCHQ (cached, TTL 6 hours)
 * @returns {Object} Thống kê tổng số TB, HS codes, enterprises, etc.
 */
export async function getPrecedentStats() {
  const cacheKey = 'precedent:stats';
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/api/precedent?stats=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  await setCache(cacheKey, data);
  return data;
}

// ==================== Cache Instrumentation (WS-003) ====================

/**
 * Get cache performance statistics
 * @returns {Object} hitRate %, hits, misses, Redis/Memory breakdown
 */
export function getCacheStats() {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? ((cacheStats.hits / total) * 100).toFixed(2) : 0;
  return {
    hitRate: `${hitRate}%`,
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    total,
    redisHits: cacheStats.redisHits,
    memoryHits: cacheStats.memoryHits,
    redisErrors: cacheStats.redisErrors,
    resetTime: cacheStats.resetTime,
  };
}

/**
 * Reset cache statistics (for monitoring cycles)
 */
export function resetCacheStats() {
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.redisHits = 0;
  cacheStats.redisErrors = 0;
  cacheStats.memoryHits = 0;
  cacheStats.resetTime = new Date().toISOString();
}
