import { Injectable, Inject } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { HumanMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory.js';
import { runAnalysisGraph, keywordClassify } from '../graph/requirement-analysis-graph.js';
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
}

export { TEST_CASES, ANALYSIS_TEST_CASES, SUPERVISOR_TEST_CASES };
export type { TestCaseResult, AnalysisTestResult, SupervisorTestResult };

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
      return {
        mode: 'fixed',
        status: hasNodeErrors ? 'failed' : 'completed',
        intent: 'analyze',
        reportId,
        usedAgents,
        steps,
        report: state.summary || undefined,
        nodeErrors: hasNodeErrors ? state.nodeErrors : undefined,
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
}
