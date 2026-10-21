export interface ParsedSection {
  title: string;
  level: number;
  content: string;
  page?: number;
}

export interface ParsedDocument {
  text: string;
  sections: ParsedSection[];
  pageCount: number | null;
  needsOcr: boolean;
}

export function parseTxt(buffer: Buffer): ParsedDocument {
  let text = '';
  try {
    // Attempt UTF-8
    const decoder = new TextDecoder('utf-8', { fatal: true });
    text = decoder.decode(buffer);
  } catch {
    try {
      // Fallback to GBK / GB18030
      const decoder = new TextDecoder('gb18030', { fatal: false });
      text = decoder.decode(buffer);
    } catch {
      // Fallback to latin1
      text = buffer.toString('latin1');
    }
  }

  // Clean null bytes and invalid control chars
  text = text.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into paragraphs / sections
  const lines = text.split('\n');
  const sections: ParsedSection[] = [];
  let currentTitle = '正文';
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect simple titles e.g. "一、" or "第1章"
    if (trimmed.length > 0 && trimmed.length < 40 && /^([一二三四五六七八九十0-9]+[、. ]|第[0-9]+[章节篇]|#+ )/.test(trimmed)) {
      if (currentContent.length > 0) {
        sections.push({
          title: currentTitle,
          level: 1,
          content: currentContent.join('\n').trim()
        });
        currentContent = [];
      }
      currentTitle = trimmed;
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({
      title: currentTitle,
      level: 1,
      content: currentContent.join('\n').trim()
    });
  }

  return {
    text,
    sections: sections.length > 0 ? sections : [{ title: '全文', level: 1, content: text.trim() }],
    pageCount: null,
    needsOcr: false
  };
}
