import { ParsedDocument, ParsedSection } from './txtParser';

export function parseMarkdown(contentOrBuffer: string | Buffer): ParsedDocument {
  const text = typeof contentOrBuffer === 'string'
    ? contentOrBuffer
    : contentOrBuffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = text.split('\n');
  const sections: ParsedSection[] = [];
  
  const headingStack: { level: number; title: string }[] = [];
  let currentContent: string[] = [];
  let inCodeBlock = false;

  function getCurrentPath(): string {
    return headingStack.map(h => h.title).join(' > ') || '正文';
  }

  function flushSection() {
    if (currentContent.length > 0) {
      const content = currentContent.join('\n').trim();
      if (content.length > 0) {
        sections.push({
          title: getCurrentPath(),
          level: headingStack.length > 0 ? headingStack[headingStack.length - 1].level : 1,
          content
        });
      }
      currentContent = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code blocks so we don't treat "# comment" inside code as markdown headers
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentContent.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        flushSection();
        const rawLevel = headerMatch[1].length;
        const title = headerMatch[2].trim().replace(/[\u2e80-\u2fdf\uf900-\ufaff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, ch => ch.normalize('NFKC'));
        const isNumberedTop = rawLevel === 1 && /^(?:[一二三四五六七八九十\d]+[、.．\s]|第[一二三四五六七八九十\d]+[章节部分]|目录$)/.test(title);
        // Anchor the document's root H1 title at level 0 so subsequent `# 一、...` chapters preserve project context
        const level = rawLevel === 1 && headingStack.length === 0 && !isNumberedTop ? 0 : rawLevel;

        // Pop stack until parent level
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        headingStack.push({ level, title });
        continue;
      }
    }

    currentContent.push(line);
  }

  flushSection();

  return {
    text,
    sections: sections.length > 0 ? sections : [{ title: '全文', level: 1, content: text.trim() }],
    pageCount: null,
    needsOcr: false
  };
}
