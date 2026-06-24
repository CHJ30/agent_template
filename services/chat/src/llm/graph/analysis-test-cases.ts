import { ChatOpenAI } from '@langchain/openai';
import { isAIMessage } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
import { runAnalysisSubGraph, MAX_TOOL_LOOPS } from './analysis-sub-graph.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AnalysisTestCase {
  id: number;
  description: string;
  input: string;
  expectsToolCalls: boolean;
  expectedTools?: string[];   // if set, these tools must be called
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
}

export interface AnalysisValidation {
  key: string;
  description: string;
  pass: boolean;
}

export interface AnalysisTestResult {
  caseId: number;
  description: string;
  input: string;
  path: string[];
  toolCalls: ToolCallRecord[];
  toolLoopCount: number;
  analysisResult: string;
  durationMs: number;
  pass: boolean;
  validations: AnalysisValidation[];
  error?: string;
}

// ─── Test cases ────────────────────────────────────────────────────────────────

export const ANALYSIS_TEST_CASES: AnalysisTestCase[] = [
  {
    id: 1,
    description: '普通聊天 → 直接输出分析，无工具调用',
    input: '你好，请介绍一下你自己',
    expectsToolCalls: false,
  },
  {
    id: 2,
    description: '带 REQ 编号 → 触发 search_requirement',
    input: '请分析 REQ-20240315-001',
    expectsToolCalls: true,
    expectedTools: ['search_requirement'],
  },
  {
    id: 3,
    description: '登录/认证需求 → 触发 check_conflicts',
    input: '设计用户登录和 JWT 认证系统，支持记住登录状态和权限控制',
    expectsToolCalls: true,
    expectedTools: ['check_conflicts'],
  },
  {
    id: 4,
    description: '带编号 + 认证功能 → 触发两个工具',
    input:
      '分析 REQ-20240315-001：在线问卷系统，需要用户登录后才能创建和发布问卷',
    expectsToolCalls: true,
    expectedTools: ['search_requirement', 'check_conflicts'],
  },
  {
    id: 5,
    description: '工具轮次上限验证（不超过 6 次）',
    input:
      '分析 REQ-20240315-001：在线问卷系统，需要用户登录验证、文件上传、权限管理，请逐模块做冲突检测',
    expectsToolCalls: true,
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────────

export async function runAnalysisTestCase(
  model: ChatOpenAI,
  caseId: number,
): Promise<AnalysisTestResult> {
  const tc = ANALYSIS_TEST_CASES.find(c => c.id === caseId);
  if (!tc) throw new Error(`Analysis test case ${caseId} not found`);

  const start = Date.now();
  try {
    const state = await runAnalysisSubGraph(model, tc.input);
    const durationMs = Date.now() - start;

    // ── Reconstruct execution path from message types ──
    const path: string[] = ['agent'];
    for (const msg of state.messages) {
      const t = msg._getType();
      if (t === 'tool') {
        if (path.at(-1) !== 'tools') path.push('tools');
      } else if (t === 'ai' && path.at(-1) === 'tools') {
        path.push('agent');
      }
    }
    path.push('finalize');

    // ── Extract tool calls from AI messages ──
    const toolCalls: ToolCallRecord[] = [];
    for (const msg of state.messages) {
      if (isAIMessage(msg)) {
        for (const tc2 of (msg as AIMessage).tool_calls ?? []) {
          toolCalls.push({
            name: tc2.name,
            args: tc2.args as Record<string, unknown>,
          });
        }
      }
    }
    const calledNames = toolCalls.map(c => c.name);

    // ── Validations ──
    const validations: AnalysisValidation[] = [];

    validations.push({
      key:         'has_result',
      description: '分析结果非空（>50字）',
      pass:        state.analysisResult.trim().length > 50,
    });

    if (tc.expectsToolCalls) {
      if (tc.expectedTools?.length) {
        for (const expected of tc.expectedTools) {
          validations.push({
            key:         `tool_${expected}`,
            description: `调用了工具 ${expected}`,
            pass:        calledNames.includes(expected),
          });
        }
      } else {
        validations.push({
          key:         'has_tool_calls',
          description: '至少调用了一个工具',
          pass:        toolCalls.length > 0,
        });
      }
    } else {
      validations.push({
        key:         'no_tool_calls',
        description: '无工具调用（直接生成分析）',
        pass:        toolCalls.length === 0,
      });
    }

    validations.push({
      key:         'loop_limit',
      description: `工具轮次 ≤ ${MAX_TOOL_LOOPS}（实际: ${state.toolLoopCount}）`,
      pass:        state.toolLoopCount <= MAX_TOOL_LOOPS,
    });

    return {
      caseId:         tc.id,
      description:    tc.description,
      input:          tc.input,
      path,
      toolCalls,
      toolLoopCount:  state.toolLoopCount,
      analysisResult: state.analysisResult,
      durationMs,
      pass:           validations.every(v => v.pass),
      validations,
    };
  } catch (e) {
    return {
      caseId:         tc.id,
      description:    tc.description,
      input:          tc.input,
      path:           [],
      toolCalls:      [],
      toolLoopCount:  0,
      analysisResult: '',
      durationMs:     Date.now() - start,
      pass:           false,
      validations:    [],
      error:          e instanceof Error ? e.message : String(e),
    };
  }
}
