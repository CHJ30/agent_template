import { parseText } from './text.parser.js';
import { parsePdf } from './pdf.parser.js';
import { parseDocx } from './docx.parser.js';

export interface ParsedBlock {
  text: string;
  pageNumber?: number;
  sectionTitle?: string;
  startOffset: number;
  endOffset: number;
}

export interface ParsedDocument {
  canonicalText: string;
  blocks: ParsedBlock[];
}

export async function extractText(filePath: string, mimeType: string): Promise<string> {
  switch (mimeType) {
    case 'text/plain':
    case 'text/markdown':
    case 'text/x-markdown':
      return parseText(filePath);
    case 'application/pdf':
      return parsePdf(filePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return parseDocx(filePath);
    default:
      throw new Error(`Unsupported MIME type for parsing: ${mimeType}`);
  }
}

function inferSectionTitle(text: string, mimeType: string): string | undefined {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (mimeType.includes('markdown')) {
    const heading = lines.find(line => /^#{1,6}\s+/.test(line));
    return heading?.replace(/^#{1,6}\s+/, '').trim();
  }
  return lines.find(line =>
    line.length <= 80 && (/^第[一二三四五六七八九十百千万零〇0-9]+[编章节条款]/.test(line) || /^(chapter|section)\s+/i.test(line)),
  );
}

export async function extractDocument(filePath: string, mimeType: string): Promise<ParsedDocument> {
  const extracted = await extractText(filePath, mimeType);
  const pagePattern = /\fPAGE:(\d+)\f/g;
  const matches = [...extracted.matchAll(pagePattern)];
  const rawBlocks = matches.length > 0
    ? matches.map((match, index) => ({
        text: extracted.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? extracted.length),
        pageNumber: Number(match[1]),
      }))
    : [{ text: extracted, pageNumber: undefined }];

  let canonicalText = '';
  const blocks: ParsedBlock[] = [];
  for (const raw of rawBlocks) {
    const text = raw.text.replace(/^\s+|\s+$/g, '');
    if (!text) continue;
    if (canonicalText) canonicalText += '\n\n';
    const startOffset = canonicalText.length;
    canonicalText += text;
    blocks.push({
      text,
      pageNumber: raw.pageNumber,
      sectionTitle: inferSectionTitle(text, mimeType),
      startOffset,
      endOffset: canonicalText.length,
    });
  }
  return { canonicalText, blocks };
}
