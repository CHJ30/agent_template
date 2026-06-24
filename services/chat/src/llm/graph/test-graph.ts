import { ChatOpenAI } from '@langchain/openai';
import { runAnalysisGraph } from './requirement-analysis-graph.js';
import type { RequirementState } from './requirement-analysis-graph.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TestCaseDefinition {
  id: number;
  description: string;
  input: string;
  expectedIntent: 'analyze' | 'query' | 'chat';
  /** For ambiguous cases: both intents are acceptable. */
  acceptableIntents?: Array<'analyze' | 'query' | 'chat'>;
  skipClarification: boolean;
  /** Soft timing limit in ms (used as a validation check). */
  maxDurationMs: number;
}

export interface TestValidation {
  key: string;
  description: string;
  pass: boolean;
}

export interface TestCaseResult {
  caseId: number;
  description: string;
  input: string;
  expectedIntent: string;
  actualIntent: string;
  intentMatch: boolean;
  validations: TestValidation[];
  durationMs: number;
  pass: boolean;
  error?: string;
}

// ─── Test cases ────────────────────────────────────────────────────────────────

export const TEST_CASES: TestCaseDefinition[] = [
  {
    id: 1,
    description: '完整需求分析',
    input: '分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型（单选、多选、填空、矩阵），用户需要能够创建、编辑、发布和统计问卷结果',
    expectedIntent: 'analyze',
    skipClarification: true,
    maxDurationMs: 180_000,
  },
  {
    id: 2,
    description: '需求状态查询',
    input: '查询 REQ-20240315-001 的当前状态',
    expectedIntent: 'query',
    skipClarification: false,
    maxDurationMs: 30_000,
  },
  {
    id: 3,
    description: '普通闲聊（响应应明显快于分析）',
    input: '你好，今天天气不错',
    expectedIntent: 'chat',
    skipClarification: false,
    maxDurationMs: 10_000,
  },
  {
    id: 4,
    description: '模糊意图（analyze/query 均可接受）',
    input: '看看 REQ-20240315-001 有没有什么问题',
    expectedIntent: 'query',
    acceptableIntents: ['analyze', 'query'],
    skipClarification: false,
    maxDurationMs: 30_000,
  },
  {
    id: 5,
    description: '带编号查询（编号优先级高）',
    input: 'REQ-20240415-002 的进度如何',
    expectedIntent: 'query',
    skipClarification: false,
    maxDurationMs: 30_000,
  },
  {
    id: 6,
    description: '简短需求分析',
    input: '我需要一个用户登录功能',
    expectedIntent: 'analyze',
    skipClarification: true,
    maxDurationMs: 180_000,
  },
  {
    id: 7,
    description: '多重含义（"查询"优先于"分析"）',
    input: '查询 REQ-20240315-001 的风险分析报告',
    expectedIntent: 'query',
    skipClarification: false,
    maxDurationMs: 30_000,
  },
];

// ─── Validation ────────────────────────────────────────────────────────────────

function validateState(
  tc: TestCaseDefinition,
  state: RequirementState,
  durationMs: number,
): TestValidation[] {
  const acceptable = tc.acceptableIntents ?? [tc.expectedIntent];
  const validations: TestValidation[] = [];

  validations.push({
    key: 'intent',
    description: `意图识别 → ${state.intent}（期望: ${acceptable.join(' 或 ')}）`,
    pass: acceptable.includes(state.intent),
  });

  const effectiveIntent = state.intent;

  if (effectiveIntent === 'analyze') {
    validations.push({
      key: 'extracted',
      description: 'extracted（需求提取）非空',
      pass: state.extracted.length > 0,
    });
    validations.push({
      key: 'analysis',
      description: 'analysis（需求分析）非空',
      pass: state.analysisResult.length > 0,
    });
    validations.push({
      key: 'risk',
      description: 'risk（风险分析）非空',
      pass: state.risk.length > 0,
    });
    validations.push({
      key: 'summary',
      description: 'summary（分析报告）非空',
      pass: state.summary.length > 0,
    });
  }

  if (effectiveIntent === 'query') {
    validations.push({
      key: 'queryResponse',
      description: 'queryResponse（查询响应）非空',
      pass: state.queryResponse.length > 0,
    });
    validations.push({
      key: 'notAnalyzed',
      description: '需求提取节点未触发（extracted 为空）',
      pass: state.extracted.length === 0,
    });
  }

  if (effectiveIntent === 'chat') {
    validations.push({
      key: 'chatResponse',
      description: 'chatResponse（聊天响应）非空',
      pass: state.chatResponse.length > 0,
    });
    validations.push({
      key: 'noBusinessNodes',
      description: '业务节点未触发（extracted、analysis 均为空）',
      pass: state.extracted.length === 0 && state.analysisResult.length === 0,
    });
    validations.push({
      key: 'duration',
      description: `响应时间 < ${tc.maxDurationMs / 1000}s（实际: ${(durationMs / 1000).toFixed(1)}s）`,
      pass: durationMs < tc.maxDurationMs,
    });
  }

  return validations;
}

// ─── Runner ────────────────────────────────────────────────────────────────────

export async function runTestCase(
  model: ChatOpenAI,
  caseId: number,
): Promise<TestCaseResult> {
  const tc = TEST_CASES.find(t => t.id === caseId);
  if (!tc) throw new Error(`Test case ${caseId} not found`);

  const start = Date.now();
  try {
    const state = await runAnalysisGraph(model, tc.input, tc.skipClarification);
    const durationMs = Date.now() - start;
    const validations = validateState(tc, state, durationMs);
    const acceptable = tc.acceptableIntents ?? [tc.expectedIntent];
    const intentMatch = acceptable.includes(state.intent);
    const pass = intentMatch && validations.every(v => v.pass);

    return {
      caseId: tc.id,
      description: tc.description,
      input: tc.input,
      expectedIntent: acceptable.join('/'),
      actualIntent: state.intent,
      intentMatch,
      validations,
      durationMs,
      pass,
    };
  } catch (e) {
    const durationMs = Date.now() - start;
    return {
      caseId: tc.id,
      description: tc.description,
      input: tc.input,
      expectedIntent: tc.expectedIntent,
      actualIntent: 'error',
      intentMatch: false,
      validations: [{
        key: 'error',
        description: `执行错误: ${e instanceof Error ? e.message : String(e)}`,
        pass: false,
      }],
      durationMs,
      pass: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
