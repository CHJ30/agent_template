import * as fs from 'fs';
import * as path from 'path';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace');

// 路径沙箱：所有操作必须在 workspace/ 内
function safePath(relative: string): string {
  const normalized = path.normalize(relative);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`非法路径 "${relative}"：不允许访问 workspace 目录之外`);
  }
  return path.join(WORKSPACE_ROOT, normalized);
}

export const queryRequirement = tool(
  async ({ requirementId }: { requirementId: string }) => {
    const abs = safePath(`requirements/${requirementId}.json`);
    try {
      return `需求单 ${requirementId} 内容：\n${fs.readFileSync(abs, 'utf-8')}`;
    } catch {
      return `需求单 "${requirementId}" 不存在（路径：workspace/requirements/${requirementId}.json）`;
    }
  },
  {
    name: 'query_requirement',
    description: '根据需求单号查询需求详情，读取 workspace/requirements/{requirementId}.json',
    schema: z.object({
      requirementId: z.string().describe('需求单号，例如 REQ-2026-001'),
    }),
  },
);

export const readFile = tool(
  async ({ filePath }: { filePath: string }) => {
    const abs = safePath(filePath);
    try {
      return fs.readFileSync(abs, 'utf-8');
    } catch {
      return `文件 "workspace/${filePath}" 不存在或无法读取`;
    }
  },
  {
    name: 'read_file',
    description: '读取 workspace 目录下指定路径的文件内容（规范、标准、参考文档等）',
    schema: z.object({
      filePath: z.string().describe('workspace/ 下的相对路径，例如 standards/requirement-spec.md'),
    }),
  },
);

export const writeFile = tool(
  async ({ filePath, content }: { filePath: string; content: string }) => {
    const abs = safePath(filePath);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
      return `已写入：workspace/${filePath}（${content.length} 字符）`;
    } catch (err) {
      return `写入失败：${(err as Error).message}`;
    }
  },
  {
    name: 'write_file',
    description: '将内容写入 workspace 目录下指定路径（分析报告、输出制品等）',
    schema: z.object({
      filePath: z.string().describe('workspace/ 下的相对路径，例如 reports/REQ-2026-001-analysis.md'),
      content: z.string().describe('要写入的完整文件内容'),
    }),
  },
);

export const businessTools: StructuredToolInterface[] = [
  queryRequirement,
  readFile,
  writeFile,
];
