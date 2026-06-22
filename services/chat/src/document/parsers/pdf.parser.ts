import * as fs from 'fs';
import pdfParse from 'pdf-parse';

export async function parsePdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}
