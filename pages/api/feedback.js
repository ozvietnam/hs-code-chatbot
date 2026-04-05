import { saveFeedback } from '../../lib/stores/sessionStore';

/**
 * POST /api/feedback — Save user thumbs up/down feedback
 * Body: { sessionId, messageIndex, rating: 'up' | 'down' }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sessionId, messageIndex, rating } = req.body || {};

  if (!sessionId || messageIndex == null || !['up', 'down'].includes(rating)) {
    return res.status(400).json({ error: 'Missing or invalid fields: sessionId, messageIndex, rating (up|down)' });
  }

  try {
    await saveFeedback(sessionId, messageIndex, rating);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
