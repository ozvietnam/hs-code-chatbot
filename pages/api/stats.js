import { getCacheStats, resetCacheStats } from '../../lib/hsApi';

/**
 * GET /api/stats — Cache performance metrics for WS-003 monitoring
 * GET /api/stats?reset=true — Reset cache stats
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if reset is requested
    if (req.query.reset === 'true') {
      resetCacheStats();
      return res.status(200).json({
        message: 'Cache stats reset',
        stats: getCacheStats(),
      });
    }

    // Return current cache stats
    const stats = getCacheStats();
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      cache: stats,
      description: {
        hitRate: 'Percentage of cache hits',
        hits: 'Total cache hits from both Redis and Memory',
        misses: 'Total cache misses',
        redisHits: 'Cache hits from Redis (persistent)',
        memoryHits: 'Cache hits from in-memory fallback',
        redisErrors: 'Errors when attempting Redis access',
      },
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return res.status(500).json({
      error: error.message,
    });
  }
}
