import {
  addKnowledgeItem,
  searchByHSCodes,
  searchByContent,
  searchByType,
  getKnowledgeStats,
} from '../../../lib/stores/knowledgeStore';

/**
 * Admin API for Knowledge Base management
 *
 * GET  /api/admin/knowledge                     → stats
 * GET  /api/admin/knowledge?type=hs_insight     → list by type
 * GET  /api/admin/knowledge?hs=85334000         → search by HS code
 * GET  /api/admin/knowledge?q=cảm biến          → search by content
 * POST /api/admin/knowledge                     → add new item
 */
export default async function handler(req, res) {
  // Simple auth — check admin secret
  const adminKey = process.env.ADMIN_SECRET || 'admin';
  const authHeader = req.headers['x-admin-key'] || req.query.key;
  if (process.env.NODE_ENV === 'production' && authHeader !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized. Set x-admin-key header.' });
  }

  if (req.method === 'GET') {
    try {
      const { type, hs, q } = req.query;

      if (type) {
        const items = await searchByType(type, 20);
        return res.status(200).json({ type, count: items.length, items });
      }

      if (hs) {
        const codes = hs.split(',');
        const items = await searchByHSCodes(codes, 10);
        return res.status(200).json({ hs_codes: codes, count: items.length, items });
      }

      if (q) {
        const items = await searchByContent(q, 10);
        return res.status(200).json({ query: q, count: items.length, items });
      }

      // Default: return stats
      const stats = await getKnowledgeStats();
      return res.status(200).json({ stats });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { type, content, hs_codes, confidence, source } = req.body;

      if (!type || !content) {
        return res.status(400).json({ error: 'type and content are required' });
      }

      const validTypes = ['hs_insight', 'confusion', 'precedent', 'pricing', 'regulation'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
      }

      const id = await addKnowledgeItem({
        type,
        content,
        hsCodes: hs_codes || [],
        confidence: confidence || 0.8,
        source: source || 'manual',
      });

      return res.status(201).json({ success: true, id, message: 'Knowledge item added' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
