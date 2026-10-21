import zlib from 'zlib';
import { PDFParse } from 'pdf-parse';
import { ParsedDocument, ParsedSection } from './txtParser';

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  let parser: any = null;
  try {
    parser = new PDFParse({ data: buffer });
    await parser.load();
    const textResult = await parser.getText();
    const info = await parser.getInfo();
    const totalPages = textResult.total || info?.total || 1;

    const sections: ParsedSection[] = [];
    const fullTextParts: string[] = [];
    let totalChars = 0;

    for (const p of textResult.pages) {
      const pageText = (p.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      const pageNum = p.num || 1;
      if (pageText.length > 0) {
        totalChars += pageText.length;
        fullTextParts.push(pageText);
        sections.push({
          title: `第 ${pageNum} 页`,
          level: 1,
          content: pageText,
          page: pageNum
        });
      }
    }

    const needsOcr = totalChars === 0 || (totalPages > 1 && totalChars < totalPages * 5);
    const fullText = fullTextParts.join('\n\n');

    return {
      text: fullText,
      sections: sections.length > 0 ? sections : [{ title: '正文', level: 1, content: fullText, page: 1 }],
      pageCount: totalPages,
      needsOcr
    };
  } catch (err: any) {
    console.warn('PDF parsing with pdf-parse failed, attempting fallback:', err.message);
    return parsePdfFallback(buffer);
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {}
    }
  }
}

function parsePdfFallback(buffer: Buffer): ParsedDocument {
  const contentStr = buffer.toString('binary');
  const sections: ParsedSection[] = [];
  const fullTextParts: string[] = [];

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;

  let pageIndex = 1;
  let totalExtractedLength = 0;

  const streams: Buffer[] = [];
  while ((streamMatch = streamRegex.exec(contentStr)) !== null) {
    const rawData = buffer.subarray(streamMatch.index + streamMatch[0].indexOf('\n') + 1, streamMatch.index + streamMatch[0].lastIndexOf('\n'));
    let decompressed: Buffer | null = null;
    try {
      decompressed = zlib.inflateSync(rawData);
    } catch {
      try {
        decompressed = zlib.inflateRawSync(rawData);
      } catch {
        decompressed = rawData;
      }
    }
    if (decompressed) {
      streams.push(decompressed);
    }
  }

  for (const stream of streams) {
    const streamText = stream.toString('latin1');
    const btRegex = /BT\s+([\s\S]*?)\s+ET/g;
    let btMatch: RegExpExecArray | null;
    const pageContent: string[] = [];

    while ((btMatch = btRegex.exec(streamText)) !== null) {
      const block = btMatch[1];
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        pageContent.push(tjMatch[1]);
      }

      const arrayTjRegex = /\[(.*?)\]\s*TJ/g;
      let arrayMatch: RegExpExecArray | null;
      while ((arrayMatch = arrayTjRegex.exec(block)) !== null) {
        const inner = arrayMatch[1];
        const innerMatches = inner.match(/\(([^)]*)\)/g);
        if (innerMatches) {
          for (const m of innerMatches) {
            pageContent.push(m.slice(1, -1));
          }
        }
      }
    }

    if (pageContent.length > 0) {
      const joined = pageContent
        .map(s => s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (joined.length > 0) {
        totalExtractedLength += joined.length;
        fullTextParts.push(joined);
        sections.push({
          title: `第 ${pageIndex} 页`,
          level: 1,
          content: joined,
          page: pageIndex
        });
        pageIndex++;
      }
    }
  }

  const pageObjectCount = (contentStr.match(/\/Type\s*\/Page\b/g) || []).length;
  const pageCount = pageObjectCount > 0 ? pageObjectCount : (sections.length > 0 ? sections.length : 1);
  const needsOcr = totalExtractedLength === 0 || (pageCount > 1 && totalExtractedLength < pageCount * 5);
  const text = fullTextParts.join('\n\n');

  return {
    text,
    sections: sections.length > 0 ? sections : [{ title: '正文', level: 1, content: text, page: 1 }],
    pageCount,
    needsOcr
  };
}
