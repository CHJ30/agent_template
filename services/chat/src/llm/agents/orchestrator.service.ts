import { Injectable, Inject } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { HumanMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory.js';
import { runAnalysisGraph, createAnalysisGraph, keywordClassify, REQ_ID_RE } from '../graph/requirement-analysis-graph.js';
import type { RequirementState } from '../graph/requirement-analysis-graph.js';
import { createAnalysisSupervisorSubGraph } from '../graph/experts.js';
import { RequirementReportService } from './requirement-report.service.js';
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
import { createLogger } from '../../observability/logger.js';
import { nodeTracer } from '../../observability/node-tracer.js';
import type { ExpertTiming, NodeTrace } from '../../observability/node-tracer.js';

const log = createLogger('orchestrator');

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

// Always shown after extraction (see clarify-form branch below) when the
// clarify step's own model call returned no usable questions — every
// requirement gets at least one round of confirmation before analysis runs.
const DEFAULT_CLARIFY_QUESTIONS = [
  '目标用户是谁？',
  '核心功能点有哪些？',
  '是否有明确的约束条件（性能、安全、合规等）？',
  '优先级是什么（P0/P1/P2/P3）？',
];

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

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly requirementReportService: RequirementReportService,
  ) {
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
      if (!hasNodeErrors) {
        void this.requirementReportService.save({
          reportId,
          input,
          extracted:      state.extracted,
          analysisResult: state.analysisResult,
          risk:           state.risk,
          summary:        state.summary ?? '',
        });
      }
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
    sessionId = 'anonymous',
  ): AsyncGenerator<StreamEnvelope> {
    const requestId = `${sessionId}:${Date.now()}`;
    nodeTracer.startRequest(sessionId, requestId);
    const usedAgents: string[] = [];
    const nodeErrors: string[] = [];
    let persistedContent = '';
    let intent: 'analyze' | 'query' | 'chat' = keywordClassify(input);
    let totalSteps = totalStepsForIntent(intent);
    let completedSteps = 0;

    try {
      yield { messageType: 'progress', progress: 0 };
      yield { messageType: 'agent_start', agent: 'classifier', label: AGENT_LABELS.classifier };
      nodeTracer.nodeStarted(requestId, 'classifier');

      // A query-intent message referencing a known report ID gets the real,
      // previously persisted report content injected so queryHandler answers
      // from actual data instead of asking the LLM to fabricate a plausible one.
      let augmentedInput = input;
      const reqIdMatch = input.match(REQ_ID_RE);
      if (reqIdMatch && intent === 'query') {
        const report = await this.requirementReportService.findById(reqIdMatch[0].toUpperCase());
        if (report) {
          augmentedInput =
            `${input}\n\n[系统内部数据 - 该需求的完整分析报告，请基于此回答用户问题]:\n${report.summary}`;
        }
      }

      const app = createAnalysisGraph(this.model);
      const stream = await app.stream(
        { messages: [new HumanMessage(augmentedInput)], skipClarification },
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

        // ── node lifecycle tracing ─────────────────────────────────────────
        {
          const anyUpdate = update as Record<string, unknown>;
          const meta: NodeTrace['meta'] = {};
          if (nodeName === 'classifier' && typeof anyUpdate.intent === 'string')
            meta.intent = anyUpdate.intent as 'analyze' | 'query' | 'chat';
          if (nodeName === 'summaryStep' && typeof anyUpdate.reviseCount === 'number')
            meta.reviseCount = anyUpdate.reviseCount;
          if (nodeName === 'analysisStep' && anyUpdate.expertTimings)
            meta.expertTimings = anyUpdate.expertTimings as Record<string, ExpertTiming>;
          nodeTracer.nodeEnded(requestId, nodeName, meta);
        }

        yield { messageType: 'agent_end', agent: nodeName, label: AGENT_LABELS[nodeName] ?? nodeName };
        yield { messageType: 'progress', progress: Math.min(99, Math.round((completedSteps / totalSteps) * 100)) };

        // ── requirement extraction result ───────────────────────────────────
        if (nodeName === 'extractStep') {
          const extracted = parseJson(update.extracted ?? '');
          if (extracted) {
            const extractPromptText = '已为您提取以下需求信息：';
            persistedContent += extractPromptText;
            yield { messageType: 'markdown', isChunk: true, content: extractPromptText };

            const fields: Array<{ label: string; value: string }> = [];
            if (extracted.coreAction) fields.push({ label: '核心动作', value: String(extracted.coreAction) });
            if (Array.isArray(extracted.targetUsers) && extracted.targetUsers.length)
              fields.push({ label: '目标用户', value: extracted.targetUsers.join('、') });
            if (Array.isArray(extracted.functionalPoints) && extracted.functionalPoints.length)
              fields.push({ label: '功能点', value: extracted.functionalPoints.join('；') });
            if (Array.isArray(extracted.constraints) && extracted.constraints.length)
              fields.push({ label: '约束条件', value: extracted.constraints.join('；') });
            if (Array.isArray(extracted.keywords) && extracted.keywords.length)
              fields.push({ label: '关键词', value: extracted.keywords.join('、') });

            yield {
              messageType: 'ui',
              component: {
                type: 'card',
                id: `card-extract-${Date.now()}`,
                title: extracted.title ? String(extracted.title) : '需求提取结果',
                subtitle: extracted.scope ? String(extracted.scope) : undefined,
                fields,
              },
            };
          }
        }

        // ── needs_clarification short-circuit ──────────────────────────────
        // Every requirement gets at least one clarification round before
        // analysis runs — we don't gate this on the clarify step's own
        // needsClarification judgment, since a vague input (e.g. "我要一个
        // todo需求") can still produce a JSON blob that *looks* complete
        // (the extract step fills every field, even generically), fooling
        // that judgment into skipping clarification entirely.
        if (nodeName === 'clarifyStep' && !skipClarification) {
          const parsed = parseJson(update.clarified ?? '');
          const questions = Array.isArray(parsed?.questions) ? parsed.questions.filter(Boolean) : [];
          clarifyQuestions = questions.length ? questions : DEFAULT_CLARIFY_QUESTIONS;
          break;
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
          nodeTracer.nodeStarted(requestId, next);
        }
      }

      // ── needs_clarification path ────────────────────────────────────────────
      if (clarifyQuestions) {
        const clarifyPromptText = '为了更准确地分析您的需求，请补充以下信息：';
        persistedContent += clarifyPromptText;
        yield { messageType: 'markdown', isChunk: true, content: clarifyPromptText };
        yield {
          messageType: 'ui',
          component: {
            type: 'form',
            id: `form-clarify-${Date.now()}`,
            title: '需要补充信息',
            description: '请回答以下问题，以便更好地分析您的需求',
            fields: clarifyQuestions.map((q, i) => ({
              name: `q${i}`,
              label: q,
              fieldType: 'textarea',
              required: false,
              rows: 2,
              placeholder: '请在此输入您的回答…',
            })),
            submitLabel: '提交补充信息',
          },
        };
        nodeTracer.endRequest(requestId, 'needs_clarification');
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

        // Fire-and-forget: persist so a later query-intent message (e.g.
        // "查询 REQ-... 的状态") can look up the real report. Never awaited —
        // a slow/unreachable DB must not delay the SSE 'done' event, and
        // save() already swallows its own errors.
        if (!hasNodeErrors) {
          void this.requirementReportService.save({
            reportId,
            input,
            extracted:      finalState.extracted,
            analysisResult: finalState.analysisResult,
            risk:           finalState.risk,
            summary:        finalState.summary ?? '',
          });
        }

        const reportPromptText = '\n\n您可以点击下方按钮查看完整的分析报告：';
        persistedContent += reportPromptText;
        yield { messageType: 'markdown', isChunk: true, content: reportPromptText };
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

        nodeTracer.endRequest(requestId, hasNodeErrors ? 'failed' : 'completed');
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

      nodeTracer.endRequest(requestId, hasNodeErrors ? 'failed' : 'completed');
      yield {
        messageType: 'done',
        status: hasNodeErrors ? 'failed' : 'completed',
        intent,
        usedAgents,
        content: persistedContent,
      };
    } catch (err) {
      nodeTracer.endRequest(requestId, 'error');
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
          log.warn({ err: e instanceof Error ? e.message : String(e) }, 'ping_retry_after_failure');
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
