import { Injectable, Inject } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { HumanMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory.js';
import { runAnalysisGraph, createAnalysisGraph, keywordClassify } from '../graph/requirement-analysis-graph.js';
import type { RequirementState } from '../graph/requirement-analysis-graph.js';
import { createAnalysisSupervisorSubGraph } from '../graph/experts.js';
import { TEST_CASES, runTestCase } from '../graph/test-graph.js';
import type { TestCaseResult } from '../graph/test-graph.js';
import {
  ANALYSIS_TEST_CASES,
  runAnalysisTestCase,
} from '../graph/analysis-test-cases.js';
import type { AnalysisTestResult } from '../graph/analysis-test-cases.js';
import {
  SUPERVISOR_TEST_CASES,
  runSupervisorTestCase,
} from '../graph/supervisor-test-cases.js';
import type { SupervisorTestResult } from '../graph/supervisor-test-cases.js';

export interface OrchestratorStep {
  agent: string;
  parallel: boolean;
  output: string;
}

export interface OrchestratorResult {
  mode: 'fixed';
  status: 'completed' | 'needs_clarification' | 'failed';
  intent?: 'analyze' | 'query' | 'chat';
  reportId?: string;
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  steps: OrchestratorStep[];
  report?: string;
  queryResponse?: string;
  chatResponse?: string;
  nodeErrors?: string[];
  // Expert fields — populated for the analyze intent.
  activeExperts?: string[];
  expertAnalyses?: Record<string, { output: string; degraded: boolean }>;
}

// ─── UI Response types ────────────────────────────────────────────────────────

export interface UIStep {
  label:    string;
  status:   'completed' | 'running' | 'pending' | 'skipped' | 'degraded';
  parallel: boolean;
}

export interface UIExpert {
  name:     string;
  label:    string;
  analysis: string;
  status:   'completed' | 'degraded' | 'skipped';
}

export interface UIResponse {
  status:         'completed' | 'needs_clarification' | 'failed';
  intent?:        'analyze' | 'query' | 'chat';
  reportId?:      string;
  report?:        string;
  confirmation?:  { message: string; questions: string[] };
  steps:          UIStep[];
  experts?:       UIExpert[];
  hasDegradation: boolean;
  usedAgents:     string[];
  nodeErrors?:    string[];
  fallback?:      'manual_review';
}

export { TEST_CASES, ANALYSIS_TEST_CASES, SUPERVISOR_TEST_CASES };
export type { TestCaseResult, AnalysisTestResult, SupervisorTestResult };

// ─── Streaming envelope (SSE) ───────────────────────────────────────────────────
// A single, unified envelope for every message pushed over the SSE channel.
// The frontend dispatches purely on `messageType`:
//   - 'markdown'    → prose chunks (isChunk: true means "append, don't replace")
//   - 'ui'           → a standalone UI component payload (cards, action buttons…)
//   - 'progress'     → 0-100 completion percentage of the whole pipeline
//   - 'agent_start'  → a node/agent just began executing
//   - 'agent_end'    → a node/agent just finished executing
//   - 'done'         → terminal event; connection closes right after
//   - 'error'        → terminal event carrying a human-readable error message

export type StreamMessageType =
  | 'markdown'
  | 'ui'
  | 'progress'
  | 'agent_start'
  | 'agent_end'
  | 'done'
  | 'error';

export interface StreamEnvelope {
  messageType: StreamMessageType;
  isChunk?: boolean;
  agent?: string;
  label?: string;
  content?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: Record<string, any>;
  progress?: number;
  intent?: 'analyze' | 'query' | 'chat';
  status?: 'completed' | 'needs_clarification' | 'failed';
  reportId?: string;
  usedAgents?: string[];
  error?: string;
}

const AGENT_LABELS: Record<string, string> = {
  classifier:    '意图识别',
  extractStep:   '需求提取',
  clarifyStep:   '澄清检查',
  analysisStep:  '多维度分析',
  riskStep:      '风险评估',
  summaryStep:   '报告生成',
  queryHandler:  '需求查询',
  chatHandler:   '闲聊对话',
};

// Static "what runs next" map — the graph's edges are linear per intent branch,
// so once we know the current node (and, for 'classifier', the resolved intent)
// we can predict the next node without needing a running graph instance.
const NEXT_NODE: Record<string, string | null> = {
  extractStep:   'clarifyStep',
  clarifyStep:   'analysisStep',
  analysisStep:  'riskStep',
  riskStep:      'summaryStep',
  summaryStep:   null,
  queryHandler:  null,
  chatHandler:   null,
};

// Terminal, user-facing nodes whose output is prose meant to be streamed to the
// client as markdown. Every other node ("JSON agents") is collected silently —
// only its start/end lifecycle and progress are surfaced.
const MARKDOWN_NODES = new Set(['summaryStep', 'queryHandler', 'chatHandler']);

function totalStepsForIntent(intent: 'analyze' | 'query' | 'chat'): number {
  // analyze: classifier → extract → clarify → analysis → risk → summary (6)
  // query/chat: classifier → handler (2)
  return intent === 'analyze' ? 6 : 2;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

const DEGRADED_MARKER = '专家暂不可用';

function isDegraded(s: string): boolean {
  return s.includes(DEGRADED_MARKER) || s.startsWith('[ERROR]');
}

function buildExpertAnalyses(state: {
  functionalAnalysis:  string;
  performanceAnalysis: string;
  securityAnalysis:    string;
  complianceAnalysis:  string;
}): Record<string, { output: string; degraded: boolean }> {
  const result: Record<string, { output: string; degraded: boolean }> = {};
  const entries: Array<[string, string]> = [
    ['functional',  state.functionalAnalysis  ?? ''],
    ['performance', state.performanceAnalysis ?? ''],
    ['security',    state.securityAnalysis    ?? ''],
    ['compliance',  state.complianceAnalysis  ?? ''],
  ];
  for (const [name, output] of entries) {
    if (output.trim()) result[name] = { output, degraded: isDegraded(output) };
  }
  return result;
}

function parseJson(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

@Injectable()
export class OrchestratorService {
  private readonly model: ChatOpenAI;

  constructor(@Inject(LLM_CONFIG) config: LlmConfig) {
    this.model = createChatModel(config);
  }

  async orchestrate(input: string, skipClarification = false): Promise<OrchestratorResult> {
    const steps: OrchestratorStep[] = [];
    const usedAgents: string[] = [];
    // Keyword-based fallback intent — used when the graph throws before returning state.
    let fallbackIntent: 'analyze' | 'query' | 'chat' = keywordClassify(input);

    try {
      const state = await runAnalysisGraph(this.model, input, skipClarification);
      fallbackIntent = state.intent;

      steps.push({ agent: 'classifierAgent', parallel: false, output: state.intent });
      usedAgents.push('classifierAgent');

      // ── query path ─────────────────────────────────────────────────────────
      if (state.intent === 'query') {
        steps.push({ agent: 'queryHandlerAgent', parallel: false, output: state.queryResponse });
        usedAgents.push('queryHandlerAgent');
        return {
          mode: 'fixed',
          status: 'completed',
          intent: 'query',
          usedAgents,
          steps,
          report: state.queryResponse,
          queryResponse: state.queryResponse,
        };
      }

      // ── chat path ──────────────────────────────────────────────────────────
      if (state.intent === 'chat') {
        steps.push({ agent: 'chatHandlerAgent', parallel: false, output: state.chatResponse });
        usedAgents.push('chatHandlerAgent');
        return {
          mode: 'fixed',
          status: 'completed',
          intent: 'chat',
          usedAgents,
          steps,
          report: state.chatResponse,
          chatResponse: state.chatResponse,
        };
      }

      // ── analyze path ───────────────────────────────────────────────────────
      steps.push({ agent: 'extractAgent', parallel: false, output: state.extracted });
      usedAgents.push('extractAgent');

      if (!skipClarification) {
        steps.push({ agent: 'clarifyAgent', parallel: false, output: state.clarified });
        usedAgents.push('clarifyAgent');

        const clarify = parseJson(state.clarified);
        if (clarify?.needsClarification === true) {
          return {
            mode: 'fixed',
            status: 'needs_clarification',
            intent: 'analyze',
            clarificationQuestions: clarify.questions ?? [],
            usedAgents,
            steps,
          };
        }
      }

      steps.push({ agent: 'analysisAgent', parallel: true, output: state.analysisResult });
      steps.push({ agent: 'riskAgent',     parallel: true, output: state.risk });
      usedAgents.push('analysisAgent', 'riskAgent');

      steps.push({ agent: 'summaryAgent', parallel: false, output: state.summary });
      usedAgents.push('summaryAgent');

      const hasNodeErrors = state.nodeErrors && state.nodeErrors.length > 0;
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seq = String(Math.floor(Math.random() * 900) + 100);
      const reportId = `REQ-${dateStr}-${seq}`;
      const expertAnalyses = buildExpertAnalyses(state as RequirementState);
      return {
        mode: 'fixed',
        status: hasNodeErrors ? 'failed' : 'completed',
        intent: 'analyze',
        reportId,
        usedAgents,
        steps,
        report: state.summary || undefined,
        nodeErrors: hasNodeErrors ? state.nodeErrors : undefined,
        activeExperts:  (state as RequirementState).activeExperts,
        expertAnalyses,
      };
    } catch {
      return {
        mode: 'fixed',
        status: 'failed',
        intent: fallbackIntent,
        usedAgents,
        fallback: 'manual_review',
        steps,
      };
    }
  }

  /**
   * Streaming counterpart of `orchestrate()`. Drives the same compiled
   * LangGraph via `streamMode: 'updates'` so every existing node's tested
   * logic is reused as-is — nothing is re-implemented here.
   *
   * JSON agents (classifier/extract/clarify/analysis/risk) are collected
   * silently: only their start/end lifecycle + progress is surfaced.
   * The terminal, user-facing node (summary/query/chat handler) is replayed
   * to the client as small markdown chunks so the UI can render it token by
   * token, matching the streaming UX of a true token-by-token LLM stream.
   */
  async *orchestrateStream(
    input: string,
    skipClarification = false,
  ): AsyncGenerator<StreamEnvelope> {
    const usedAgents: string[] = [];
    const nodeErrors: string[] = [];
    let persistedContent = '';
    let intent: 'analyze' | 'query' | 'chat' = keywordClassify(input);
    let totalSteps = totalStepsForIntent(intent);
    let completedSteps = 0;

    try {
      yield { messageType: 'progress', progress: 0 };
      yield { messageType: 'agent_start', agent: 'classifier', label: AGENT_LABELS.classifier };

      const app = createAnalysisGraph(this.model);
      const stream = await app.stream(
        { messages: [new HumanMessage(input)], skipClarification },
        { streamMode: 'updates' },
      );

      let finalState: Partial<RequirementState> = {};
      let clarifyQuestions: string[] | null = null;
      let terminalNode: string | null = null;

      for await (const chunk of stream) {
        const [nodeName, update] = Object.entries(chunk as Record<string, Partial<RequirementState>>)[0];
        finalState = { ...finalState, ...update };
        if (update.nodeErrors?.length) nodeErrors.push(...update.nodeErrors);
        usedAgents.push(nodeName);
        completedSteps += 1;

        if (nodeName === 'classifier') {
          intent = update.intent ?? intent;
          totalSteps = totalStepsForIntent(intent);
        }

        yield { messageType: 'agent_end', agent: nodeName, label: AGENT_LABELS[nodeName] ?? nodeName };
        yield { messageType: 'progress', progress: Math.min(99, Math.round((completedSteps / totalSteps) * 100)) };

        // ── needs_clarification short-circuit ──────────────────────────────
        if (nodeName === 'clarifyStep' && !skipClarification) {
          const parsed = parseJson(update.clarified ?? '');
          if (parsed?.needsClarification === true) {
            clarifyQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
            break;
          }
        }

        // ── terminal, user-facing node reached ─────────────────────────────
        if (MARKDOWN_NODES.has(nodeName)) {
          terminalNode = nodeName;
          break;
        }

        const next = nodeName === 'classifier'
          ? (intent === 'query' ? 'queryHandler' : intent === 'chat' ? 'chatHandler' : 'extractStep')
          : NEXT_NODE[nodeName];
        if (next) {
          yield { messageType: 'agent_start', agent: next, label: AGENT_LABELS[next] ?? next };
        }
      }

      // ── needs_clarification path ────────────────────────────────────────────
      if (clarifyQuestions) {
        yield {
          messageType: 'ui',
          component: {
            type: 'card',
            id: `card-clarify-${Date.now()}`,
            title: '需要补充信息',
            subtitle: '请在对话框中补充以下问题后重新提交',
            fields: clarifyQuestions.map((q, i) => ({ label: `Q${i + 1}`, value: q })),
          },
        };
        yield {
          messageType: 'done',
          status: 'needs_clarification',
          intent: 'analyze',
          usedAgents,
        };
        return;
      }

      // ── markdown streaming (chunked replay of the terminal node's text) ────
      const fullText =
        terminalNode === 'summaryStep' ? (finalState.summary ?? '') :
        terminalNode === 'queryHandler' ? (finalState.queryResponse ?? '') :
        (finalState.chatResponse ?? '');

      const CHUNK_SIZE = 12;
      for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
        const piece = fullText.slice(i, i + CHUNK_SIZE);
        persistedContent += piece;
        yield { messageType: 'markdown', isChunk: true, agent: terminalNode ?? undefined, content: piece };
        // eslint-disable-next-line no-await-in-loop
        await sleep(15);
      }

      yield { messageType: 'progress', progress: 100 };

      const hasNodeErrors = nodeErrors.length > 0;

      if (intent === 'analyze') {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const seq = String(Math.floor(Math.random() * 900) + 100);
        const reportId = `REQ-${dateStr}-${seq}`;

        yield {
          messageType: 'ui',
          component: {
            type: 'action_buttons',
            id: `actions-${reportId}`,
            layout: 'horizontal',
            buttons: [
              { id: 'btn-view-report', label: '查看分析报告', actionId: 'view_report', variant: 'primary', payload: { reqId: reportId } },
            ],
          },
        };

        yield {
          messageType: 'done',
          status: hasNodeErrors ? 'failed' : 'completed',
          intent,
          reportId,
          usedAgents,
          content: persistedContent,
        };
        return;
      }

      yield {
        messageType: 'done',
        status: hasNodeErrors ? 'failed' : 'completed',
        intent,
        usedAgents,
        content: persistedContent,
      };
    } catch (err) {
      yield { messageType: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async ping(): Promise<{ ok: boolean; durationMs: number; reply?: string; error?: string }> {
    const start = Date.now();
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.model.invoke([new HumanMessage('你好')]);
        const reply = typeof result.content === 'string' ? result.content.slice(0, 80) : 'ok';
        return { ok: true, durationMs: Date.now() - start, reply };
      } catch (e) {
        lastErr = e;
        if (attempt === 1) {
          console.log(`[ping] attempt 1 failed (${e instanceof Error ? e.message : e}), retrying in 2s…`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    return { ok: false, durationMs: Date.now() - start, error: lastErr instanceof Error ? lastErr.message : String(lastErr) };
  }

  runTestCase(caseId: number): Promise<TestCaseResult> {
    return runTestCase(this.model, caseId);
  }

  runAnalysisTest(caseId: number): Promise<AnalysisTestResult> {
    return runAnalysisTestCase(this.model, caseId);
  }

  runSupervisorTest(caseId: number): Promise<SupervisorTestResult> {
    return runSupervisorTestCase(this.model, caseId);
  }

  // ── UI Protocol ─────────────────────────────────────────────────────────────

  toUIResponse(result: OrchestratorResult): UIResponse {
    const hasDegradation = Object.values(result.expertAnalyses ?? {}).some(e => e.degraded);
    const steps: UIStep[] = [{ label: 'classifier', status: 'completed', parallel: false }];

    if (result.status === 'needs_clarification') {
      steps.push({ label: 'clarify', status: 'running', parallel: false });
      return {
        status: 'needs_clarification',
        intent: result.intent,
        confirmation: {
          message:   '需要补充以下信息以完成需求分析：',
          questions: result.clarificationQuestions ?? [],
        },
        steps,
        hasDegradation: false,
        usedAgents: result.usedAgents,
      };
    }

    const EXPERT_LABELS: Record<string, string> = {
      functional: '功能', performance: '性能', security: '安全', compliance: '合规',
    };

    if (result.intent === 'analyze') {
      steps.push({ label: 'extract', status: 'completed', parallel: false });
      steps.push({ label: 'clarify', status: 'completed', parallel: false });

      for (const expert of result.activeExperts ?? []) {
        const data = result.expertAnalyses?.[expert];
        const status: UIStep['status'] = !data ? 'skipped' : data.degraded ? 'degraded' : 'completed';
        steps.push({ label: `${EXPERT_LABELS[expert] ?? expert}专家`, status, parallel: true });
      }
      steps.push({ label: 'risk',    status: 'completed', parallel: true  });
      steps.push({ label: 'summary', status: result.status === 'failed' ? 'degraded' : 'completed', parallel: false });
    } else {
      steps.push({
        label:    result.intent === 'query' ? '查询处理' : '对话处理',
        status:   'completed',
        parallel: false,
      });
    }

    const experts: UIExpert[] | undefined = result.activeExperts?.map(name => {
      const data = result.expertAnalyses?.[name];
      return {
        name,
        label:    `${EXPERT_LABELS[name] ?? name}专家`,
        analysis: data?.output ?? '',
        status:   (!data ? 'skipped' : data.degraded ? 'degraded' : 'completed') as UIExpert['status'],
      };
    });

    return {
      status:       result.status,
      intent:       result.intent,
      reportId:     result.reportId,
      report:       result.report,
      steps,
      experts,
      hasDegradation,
      usedAgents:   result.usedAgents,
      nodeErrors:   result.nodeErrors,
      fallback:     result.fallback,
    };
  }

  // ── Degradation test (forces specific experts to fail) ─────────────────────

  async runDegradationTest(
    forceFailExperts: string[] = ['performance'],
  ): Promise<{ uiResponse: UIResponse; forcedFailures: string[]; degradedExperts: string[] }> {
    const supervisorGraph = createAnalysisSupervisorSubGraph(this.model, { forceFailExperts });
    const supervisorState = await supervisorGraph.invoke({
      extracted:
        '开发用户数据批量导出功能，支持按条件筛选并导出含手机号、身份证号的 Excel，需审批流程',
      activeExperts:        [],
      functionalAnalysis:   '',
      performanceAnalysis:  '',
      securityAnalysis:     '',
      complianceAnalysis:   '',
      analysisResult:       '',
      functionalToolCalls:  [],
      performanceToolCalls: [],
      securityToolCalls:    [],
      complianceToolCalls:  [],
      expertTimings:        {},
    });

    const expertAnalyses = buildExpertAnalyses(supervisorState);
    const orchResult: OrchestratorResult = {
      mode:          'fixed',
      status:        'completed',
      intent:        'analyze',
      usedAgents:    ['supervisorAgent', ...supervisorState.activeExperts.map(e => `${e}Expert`)],
      steps:         [],
      report:        supervisorState.analysisResult,
      activeExperts: supervisorState.activeExperts,
      expertAnalyses,
    };

    const degradedExperts = supervisorState.activeExperts.filter(e => expertAnalyses[e]?.degraded);
    return {
      uiResponse:     this.toUIResponse(orchResult),
      forcedFailures: forceFailExperts,
      degradedExperts,
    };
  }
}
