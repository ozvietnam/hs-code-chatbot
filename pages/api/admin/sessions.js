import { listSessions, getSessionMessages } from '../../../lib/stores/sessionStore';

/**
 * Admin API for Session management
 *
 * GET /api/admin/sessions              → list all sessions
 * GET /api/admin/sessions?id=ses_xxx   → get messages for a session
 */
export default async function handler(req, res) {
  const adminKey = process.env.ADMIN_SECRET || 'admin';
  const authKey = req.query.key || req.headers['x-admin-key'];
  if (process.env.NODE_ENV === 'production' && authKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (id) {
      const messages = await getSessionMessages(id);
      return res.status(200).json({ sessionId: id, messageCount: messages.length, messages });
    }

    const sessions = await listSessions();
    return res.status(200).json({
      totalSessions: sessions.length,
      sessions: sessions.sort((a, b) =>
        new Date(b.lastActive || 0) - new Date(a.lastActive || 0)
      ),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
