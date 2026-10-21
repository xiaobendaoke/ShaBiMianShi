import crypto from 'crypto';
import type { ChunkRecord } from '../types';
import type { ParsedDocument } from '../parsers';

export interface ChunkOptions { minTokens?: number; maxTokens?: number; overlapTokens?: number; }

// This is a budget estimate, not a model-specific tokenizer.
export function estimateTokens(text: string): number {
  let weight = 0;
  for (const char of text) {
    weight += /[\u3400-\u9fff]/u.test(char) ? 0.7 : char.length * 0.25;
  }
  return Math.ceil(weight - 1e-9);
}

// Find the largest prefix within the estimate, without cutting a surrogate pair.
function prefixEnd(text: string, start: number, budget: number): number {
  let weight = 0;
  let end = start;
  for (const char of text.slice(start)) {
    const next = /[\u3400-\u9fff]/u.test(char) ? 0.7 : char.length * 0.25;
    if (Math.ceil(weight + next - 1e-9) > budget) break;
    weight += next; end += char.length;
  }
  return end;
}

export function chunkDocument(docId: string, docVersion: number, libraryId: string,
  parsedDoc: ParsedDocument, options: ChunkOptions = {}): ChunkRecord[] {
  const max = Math.floor(options.maxTokens ?? 600);
  if (!Number.isFinite(max) || max < 1) throw new Error('maxTokens 必须为正整数');
  const overlap = Math.min(Math.max(0, Math.floor(options.overlapTokens ?? 80)), max - 1);
  const chunks: ChunkRecord[] = [];
  let sourceBase = 0;
  for (const section of parsedDoc.sections) {
    const text = section.content ?? '';
    let start = 0;
    while (start < text.length) {
      let end = prefixEnd(text, start, max);
      if (end <= start) throw new Error('分片预算不足以容纳当前字符');
      // Prefer a paragraph/sentence boundary near the end of the allowed span.
      if (end < text.length) {
        const span = text.slice(start, end);
        const boundary = /\n\s*\n|[。！？；]\s*|\n/g;
        let match: RegExpExecArray | null;
        let preferred = 0;
        while ((match = boundary.exec(span))) {
          const at = match.index + match[0].length;
          if (at >= span.length * 0.6) preferred = at;
        }
        if (preferred) end = start + preferred;
      }
      const chunkText = text.slice(start, end);
      if (chunkText.trim()) {
        const tokens = estimateTokens(chunkText);
        if (tokens > max) throw new Error('分片超过预算');
        const ordinal = chunks.length + 1;
        chunks.push({ id: `${docId}_c${ordinal}`, documentId: docId,
          documentVersion: docVersion, libraryId, sectionPath: section.title,
          pageStart: section.page ?? null, pageEnd: section.page ?? null,
          ordinal, sourceStart: sourceBase + start, sourceEnd: sourceBase + end,
          text: chunkText, contentHash: crypto.createHash('sha256').update(chunkText).digest('hex'),
          tokenEstimate: tokens, createdAt: Date.now() });
      }
      if (end === text.length) break;
      // Bound the overlap itself; never append an entire oversized predecessor.
      let next = end;
      let weight = 0;
      for (const char of Array.from(text.slice(start, end)).reverse()) {
        const amount = /[\u3400-\u9fff]/u.test(char) ? 0.7 : char.length * 0.25;
        if (Math.ceil(weight + amount - 1e-9) > overlap) break;
        weight += amount; next -= char.length;
      }
      start = next > start ? next : end;
    }
    sourceBase += text.length;
  }
  return chunks;
}
