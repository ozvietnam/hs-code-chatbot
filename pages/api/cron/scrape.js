import { callLLM } from '../../../lib/agents/shared';
import { reviewBatch } from '../../../lib/agents/librarianAgent';
import scrapeSources from '../../../lib/data/scrape-sources.json';

/**
 * Cron: Auto-Scrape Online Sources
 * Runs daily — scrapes government sites for regulation updates
 *
 * Flow: Fetch page → Gemini summarize → Create proposals → Librarian review
 */
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'LLM_API_KEY not configured' });
  }

  const log = [];
  const allProposals = [];

  try {
    const enabledSources = scrapeSources.filter(s => s.enabled);
    log.push({ step: 'init', sources: enabledSources.length });

    for (const source of enabledSources) {
      try {
        // Step 1: Fetch page content
        log.push({ step: 'fetch', source: source.id, status: 'calling' });
        const response = await fetch(source.url, {
          headers: { 'User-Agent': 'HSCodeVN-Bot/1.0' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          log[log.length - 1] = { step: 'fetch', source: source.id, status: 'error', code: response.status };
          continue;
        }

        const html = await response.text();
        // Extract text content (basic HTML stripping)
        const textContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 5000); // Limit to 5000 chars

        log[log.length - 1] = { step: 'fetch', source: source.id, status: 'done', chars: textContent.length };

        // Step 2: Gemini extract insights from page
        const prompt = `Bạn là AI phân tích tin tức hải quan Việt Nam.
Phân tích nội dung trang web sau từ ${source.name} và trích xuất THÔNG TIN MỚI có giá trị:

CONTENT:
${textContent}

Trả lời ĐÚNG JSON:
{
  "insights": [
    {
      "type": "regulation",
      "content": "Tóm tắt thông tin mới (1-3 câu)",
      "hs_codes": [],
      "confidence": 0.6
    }
  ]
}

QUY TẮC:
- Chỉ trích xuất THÔNG TIN MỚI (văn bản mới, thay đổi quy định, thông báo)
- Bỏ qua quảng cáo, menu, footer
- Trả [] rỗng nếu không có gì mới đáng lưu
- confidence: 0.6-0.7 cho tin tức, 0.8+ cho văn bản chính thức`;

        const raw = await callLLM(prompt, apiKey, { temperature: 0.1, maxTokens: 1024 });
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);

        if (parsed.insights?.length > 0) {
          allProposals.push(...parsed.insights.map(i => ({
            ...i,
            source: `scrape:${source.id}`,
          })));
        }

        log.push({ step: 'extract', source: source.id, insights: parsed.insights?.length || 0 });
      } catch (e) {
        log.push({ step: 'process', source: source.id, error: e.message });
      }
    }

    // Step 3: Send proposals to librarian
    let reviewResults = null;
    if (allProposals.length > 0) {
      reviewResults = await reviewBatch(allProposals, apiKey);
    }

    return res.status(200).json({
      success: true,
      sourcesProcessed: enabledSources.length,
      proposalsCreated: allProposals.length,
      reviewResults: reviewResults ? {
        approved: reviewResults.filter(r => r.result.action === 'approved').length,
        rejected: reviewResults.filter(r => r.result.action === 'rejected').length,
      } : null,
      log,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, log });
  }
}
