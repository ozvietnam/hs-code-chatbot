import { saveFeedback } from '../../lib/stores/sessionStore';
import { saveLearningFromFeedback } from '../../lib/agents/customsAgent';

/**
 * POST /api/feedback — Save user thumbs up/down feedback
 *
 * Body: {
 *   sessionId: string (required),
 *   messageIndex: number (required),
 *   rating: 'up' | 'down' (required),
 *   hsCode?: string (for KB learning),
 *   productName?: string (for KB learning),
 *   confidence?: number (0-1, for KB learning)
 * }
 *
 * When rating='up' and hsCode is provided:
 * - Save feedback to sessionStore
 * - Save learning to knowledgeStore (WS-001)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sessionId, messageIndex, rating, hsCode, productName, confidence } = req.body || {};

  if (!sessionId || messageIndex == null || !['up', 'down'].includes(rating)) {
    return res.status(400).json({
      error: 'Missing or invalid fields: sessionId, messageIndex, rating (up|down)'
    });
  }

  try {
    // Save feedback to session store
    await saveFeedback(sessionId, messageIndex, rating);

    // ═══════════════════════════════════════════════════════
    // WS-001: Save learning to knowledge base when positive
    // ═══════════════════════════════════════════════════════
    let kbItemId = null;
    if (rating === 'up' && hsCode && productName) {
      kbItemId = await saveLearningFromFeedback(productName, hsCode, confidence || 0.95);
    }

    return res.status(200).json({
      success: true,
      feedback_saved: true,
      kb_saved: !!kbItemId,
      kb_item_id: kbItemId
    });
  } catch (error) {
    console.error('Feedback API error:', error);
    return res.status(500).json({
      error: error.message,
      feedback_saved: false,
      kb_saved: false
    });
  }
}
