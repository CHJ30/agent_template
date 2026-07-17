import * as fs from 'fs';
import pdfParse from 'pdf-parse';

export async function parsePdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer, {
    pagerender: async (pageData: { pageIndex?: number; getTextContent: (options: object) => Promise<{ items: Array<{ str?: string; transform?: number[] }> }> }) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      let lastY: number | undefined;
      let text = '';
      for (const item of textContent.items) {
        const y = item.transform?.[5];
        text += lastY === undefined || lastY === y ? (item.str ?? '') : `\n${item.str ?? ''}`;
        lastY = y;
      }
      return `\fPAGE:${(pageData.pageIndex ?? 0) + 1}\f${text}`;
    },
  });
  return result.text;
}
