import { parseText } from './text.parser.js';
import { parsePdf } from './pdf.parser.js';
import { parseDocx } from './docx.parser.js';

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
