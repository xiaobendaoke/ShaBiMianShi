import zlib from 'zlib';
import mammoth from 'mammoth';
import { ParsedDocument, ParsedSection } from './txtParser';
import { parseMarkdown } from './mdParser';

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const result = await (mammoth as any).convertToMarkdown({ buffer });
    const md = result.value || '';
    if (md.trim().length > 0) {
      const parsed = parseMarkdown(md);
      // Mammoth escapes Markdown punctuation; store the document's actual text.
      const unescape = (value: string) => value.replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1');
      return { ...parsed, text: unescape(parsed.text), sections: parsed.sections.map(section => ({
        ...section, title: unescape(section.title), content: unescape(section.content)
      })) };
    }
  } catch (err: any) {
    console.warn('mammoth conversion failed, trying fallback zip extractor:', err.message);
  }

  return parseDocxFallback(buffer);
}

function extractZipEntry(buffer: Buffer, targetPath: string): Buffer | null {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      break;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.toString('utf-8', offset + 30, offset + 30 + fileNameLength);

    const dataStart = offset + 30 + fileNameLength + extraFieldLength;
    
    // Check if bit 3 is set (data descriptor after data)
    const hasDataDescriptor = (flags & 0x08) !== 0;

    if (fileName === targetPath) {
      if (hasDataDescriptor && compressedSize === 0) {
        // Try finding next file header or data descriptor 0x08074b50
        const descriptorIdx = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), dataStart);
        if (descriptorIdx !== -1) {
          compressedSize = descriptorIdx - dataStart;
        } else {
          const nextHeaderIdx = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
          compressedSize = nextHeaderIdx !== -1 ? nextHeaderIdx - dataStart : buffer.length - dataStart;
        }
      }

      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        return compressedData;
      } else if (compressionMethod === 8) {
        try {
          return zlib.inflateRawSync(compressedData);
        } catch {
          return null;
        }
      }
    }

    if (compressedSize > 0) {
      offset = dataStart + compressedSize;
      if (hasDataDescriptor) offset += 16;
    } else {
      offset += 1;
    }
  }
  return null;
}

function parseDocxFallback(buffer: Buffer): ParsedDocument {
  const xmlBuffer = extractZipEntry(buffer, 'word/document.xml');
  if (!xmlBuffer) {
    throw new Error('无效的 DOCX 文件：缺少 word/document.xml');
  }

  const xml = xmlBuffer.toString('utf-8');
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  const sections: ParsedSection[] = [];
  const fullTextParts: string[] = [];

  let currentTitle = '正文';
  let currentParagraphs: string[] = [];
  let pMatch: RegExpExecArray | null;

  while ((pMatch = paragraphRegex.exec(xml)) !== null) {
    const pXml = pMatch[1];
    const styleMatch = pXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
    const styleName = styleMatch ? styleMatch[1].toLowerCase() : '';

    const textMatches = pXml.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g);
    let pText = '';
    if (textMatches) {
      pText = textMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
    }
    pText = pText.trim();
    if (!pText) continue;

    if (styleName.includes('heading') || styleName.includes('title')) {
      if (currentParagraphs.length > 0) {
        const content = currentParagraphs.join('\n\n');
        sections.push({
          title: currentTitle,
          level: currentTitle.includes('1') ? 1 : 2,
          content
        });
        fullTextParts.push(content);
        currentParagraphs = [];
      }
      currentTitle = pText;
    } else {
      currentParagraphs.push(pText);
    }
  }

  if (currentParagraphs.length > 0) {
    const content = currentParagraphs.join('\n\n');
    sections.push({
      title: currentTitle,
      level: 1,
      content
    });
    fullTextParts.push(content);
  }

  const text = fullTextParts.join('\n\n');
  return {
    text,
    sections: sections.length > 0 ? sections : [{ title: '正文', level: 1, content: text, page: 1 }],
    pageCount: 1,
    needsOcr: false
  };
}
