import path from 'path';
import { parseTxt, ParsedDocument } from './txtParser';
import { parseMarkdown } from './mdParser';
import { parseDocx } from './docxParser';
import { parsePdf } from './pdfParser';

export async function parseDocument(fileName: string, buffer: Buffer): Promise<ParsedDocument> {
  const ext = path.extname(fileName).toLowerCase();

  switch (ext) {
    case '.md':
    case '.markdown':
      return parseMarkdown(buffer);
    case '.docx':
      return await parseDocx(buffer);
    case '.pdf':
      return await parsePdf(buffer);
    case '.txt':
    default:
      return parseTxt(buffer);
  }
}

export * from './txtParser';
export * from './mdParser';
export * from './docxParser';
export * from './pdfParser';
