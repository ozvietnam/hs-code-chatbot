import { listSessions, getSessionMessages, markSessionExtracted, storeProposals } from '../../../lib/stores/sessionStore';
import { extractInsights } from '../../../lib/agents/extractorAgent';

/**
 * Cron: Knowledge Extraction Pipeline
 * Runs every 6 hours — finds inactive sessions, extracts insights, creates proposals
 *
 * GET /api/cron/extract (Vercel Cron) or manual trigger
 */
export default async function handler(req, res) {
  // Verify cron secret (Vercel adds CRON_SECRET automatically)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'LLM_API_KEY not configured' });
  }

  const log = [];

  try {
    // Step 1: Find inactive, un-extracted sessions
    const sessions = await listSessions();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    const eligibleSessions = sessions.filter(s => {
      if (s.extracted) return false;
      if (s.messageCount < 4) return false; // Need at least 2 turns
      const lastActive = new Date(s.lastActive).getTime();
      return (now - lastActive) > ONE_HOUR; // Inactive for 1+ hour
    });

    log.push({ step: 'find_sessions', total: sessions.length, eligible: eligibleSessions.length });

    // Step 2: Extract insights from each session
    let totalInsights = 0;
    const allProposals = [];

    // Process in batches of 3 (parallel within each batch)
    const BATCH_SIZE = 3;
    const toProcess = eligibleSessions.slice(0, 10);
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (session) => {
          const messages = await getSessionMessages(session.sessionId);
          const insights = await extractInsights(messages, apiKey);
          await markSessionExtracted(session.sessionId);
          return { sessionId: session.sessionId, insights };
        })
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const { sessionId, insights } = r.value;
          if (insights.length > 0) {
            allProposals.push(...insights.map(i => ({ ...i, source_session: sessionId })));
            totalInsights += insights.length;
          }
          log.push({ step: 'extract', sessionId, insights: insights.length });
        } else {
          log.push({ step: 'extract', error: r.reason?.message });
        }
      }
    }

    log.push({ step: 'summary', totalInsights, proposalCount: allProposals.length });

    // Step 3: Store proposals in Redis for review cron to consume
    if (allProposals.length > 0) {
      await storeProposals(allProposals);
      log.push({ step: 'store_proposals', count: allProposals.length });
    }

    return res.status(200).json({
      success: true,
      sessionsProcessed: eligibleSessions.length,
      insightsExtracted: totalInsights,
      proposals: allProposals,
      log,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, log });
  }
}
