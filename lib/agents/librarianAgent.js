import { callLLM, MODELS } from './shared';
import { searchHS, getHSDetail } from '../hsApi';
import { findDuplicate, addKnowledgeItem } from '../stores/knowledgeStore';

/**
 * Librarian Agent — Reviews and curates knowledge proposals
 * Auto-rules handle ~70% of proposals, Gemini reviews the rest
 */

/**
 * Review a single proposal
 * @returns {{ action: 'approved'|'rejected'|'modified', reason: string, item?: object }}
 */
export async function reviewProposal(proposal, apiKey) {
  // --- Auto-rule 1: Reject empty/too-short content ---
  if (!proposal.content || proposal.content.length < 20) {
    return { action: 'rejected', reason: 'Content too short' };
  }

  // --- Auto-rule 2: Check duplicates ---
  const duplicate = await findDuplicate(proposal.content, proposal.type);
  if (duplicate) {
    return { action: 'rejected', reason: `Duplicate of item #${duplicate.id}` };
  }

  // --- Auto-rule 3: Verify HS codes if present ---
  let hsVerified = false;
  if (proposal.hs_codes?.length > 0) {
    try {
      const detail = await getHSDetail(proposal.hs_codes[0]);
      hsVerified = detail?.found !== false;
    } catch {
      hsVerified = false;
    }
  }

  // --- Auto-rule 4: High confidence + verified → auto-approve ---
  if (proposal.confidence >= 0.9 && hsVerified) {
    const id = await addKnowledgeItem({
      type: proposal.type,
      content: proposal.content,
      hsCodes: proposal.hs_codes || [],
      confidence: proposal.confidence,
      source: 'extraction',
    });
    return { action: 'approved', reason: 'Auto-approved: high confidence + HS verified', itemId: id };
  }

  // --- Auto-rule 5: Very low confidence → auto-reject ---
  if (proposal.confidence < 0.3) {
    return { action: 'rejected', reason: 'Auto-rejected: confidence too low' };
  }

  // --- Gemini review for remaining proposals ---
  return await geminiReview(proposal, apiKey, hsVerified);
}

/**
 * Use Gemini to review ambiguous proposals
 */
async function geminiReview(proposal, apiKey, hsVerified) {
  const prompt = `Bạn là Thủ thư Tri thức hải quan. Đánh giá proposal sau:

TYPE: ${proposal.type}
CONTENT: ${proposal.content}
HS_CODES: ${proposal.hs_codes?.join(', ') || 'none'}
CONFIDENCE: ${proposal.confidence}
HS_VERIFIED: ${hsVerified}

Đánh giá:
1. Nội dung có chính xác không? (dựa trên kiến thức hải quan)
2. Có hữu ích cho việc tư vấn không?
3. Có cần sửa đổi gì không?

Trả lời ĐÚNG JSON:
{"action": "approved|rejected|modified", "reason": "lý do ngắn gọn", "modified_content": "nội dung đã sửa (chỉ nếu action=modified)"}`;

  try {
    const raw = await callLLM(prompt, apiKey, { temperature: 0.1, maxTokens: 512, model: MODELS.MEDIUM });
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleaned);

    if (result.action === 'approved' || result.action === 'modified') {
      const content = result.action === 'modified'
        ? (result.modified_content || proposal.content)
        : proposal.content;

      const id = await addKnowledgeItem({
        type: proposal.type,
        content,
        hsCodes: proposal.hs_codes || [],
        confidence: proposal.confidence,
        source: 'extraction',
      });

      return { action: result.action, reason: result.reason, itemId: id };
    }

    return { action: 'rejected', reason: result.reason || 'Gemini rejected' };
  } catch (e) {
    // On error, default to pending (don't lose data)
    return { action: 'rejected', reason: `Review error: ${e.message}` };
  }
}

/**
 * Batch review multiple proposals
 */
export async function reviewBatch(proposals, apiKey) {
  const results = [];
  for (const proposal of proposals) {
    const result = await reviewProposal(proposal, apiKey);
    results.push({ proposal, result });
  }
  return results;
}
