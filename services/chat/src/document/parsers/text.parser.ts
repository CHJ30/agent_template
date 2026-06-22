import * as fs from 'fs';

export function parseText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}
