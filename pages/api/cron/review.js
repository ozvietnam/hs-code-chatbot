import { reviewBatch } from '../../../lib/agents/librarianAgent';
import { getKnowledgeStats } from '../../../lib/stores/knowledgeStore';

/**
 * Cron: Librarian Review Pipeline
 * Runs 30 min after extraction — reviews proposals and adds to KB
 *
 * POST /api/cron/review with proposals array, or GET for manual trigger
 */
export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'LLM_API_KEY not configured' });
  }

  try {
    // Proposals can come from POST body (from extract.js) or be fetched from KV
    const proposals = req.body?.proposals || [];

    if (proposals.length === 0) {
      const stats = await getKnowledgeStats();
      return res.status(200).json({
        success: true,
        message: 'No proposals to review',
        knowledgeStats: stats,
      });
    }

    // Review all proposals
    const results = await reviewBatch(proposals, apiKey);

    const summary = {
      total: results.length,
      approved: results.filter(r => r.result.action === 'approved').length,
      modified: results.filter(r => r.result.action === 'modified').length,
      rejected: results.filter(r => r.result.action === 'rejected').length,
    };

    const stats = await getKnowledgeStats();

    return res.status(200).json({
      success: true,
      summary,
      results: results.map(r => ({
        type: r.proposal.type,
        content: r.proposal.content.substring(0, 100) + '...',
        action: r.result.action,
        reason: r.result.reason,
      })),
      knowledgeStats: stats,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
