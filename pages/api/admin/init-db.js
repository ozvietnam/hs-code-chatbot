import { initKnowledgeTable } from '../../../lib/stores/knowledgeStore';

/**
 * Initialize database tables
 * Run once after setting up Vercel Postgres
 *
 * GET /api/admin/init-db?key=ADMIN_SECRET
 */
export default async function handler(req, res) {
  const adminKey = process.env.ADMIN_SECRET || 'admin';
  const authKey = req.query.key || req.headers['x-admin-key'];
  if (process.env.NODE_ENV === 'production' && authKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await initKnowledgeTable();
    return res.status(200).json({
      success: true,
      message: 'Database tables initialized successfully',
      tables: ['knowledge_items'],
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      hint: 'Make sure POSTGRES_URL is set in environment variables',
    });
  }
}
