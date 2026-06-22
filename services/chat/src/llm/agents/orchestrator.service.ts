import { Injectable, Inject } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { createChatModel } from '../model.factory.js';
import {
  createExtractAgent,
  createClarifyAgent,
  createAnalysisAgent,
  createRiskAgent,
  createSummaryAgent,
} from './sub-agents.js';

export interface OrchestratorStep {
  agent: string;
  parallel: boolean;
  output: string;
}

export interface OrchestratorResult {
  mode: 'fixed';
  status: 'completed' | 'needs_clarification' | 'failed';
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  steps: OrchestratorStep[];
  report?: string;
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

    try {
      // ── Step 1: 需求抽取 ────────────────────────────────────────
      const extractOutput = await createExtractAgent(this.model).invoke({ input });
      steps.push({ agent: 'extractAgent', parallel: false, output: extractOutput });
      usedAgents.push('extractAgent');

      const extracted = parseJson(extractOutput);
      const extractedStr = extracted ? JSON.stringify(extracted, null, 2) : extractOutput;

      // ── Step 2: 澄清判断（已完成一轮澄清时跳过）────────────────
      if (!skipClarification) {
        const clarifyOutput = await createClarifyAgent(this.model).invoke({
          extractedRequirement: extractedStr,
        });
        steps.push({ agent: 'clarifyAgent', parallel: false, output: clarifyOutput });
        usedAgents.push('clarifyAgent');

        const clarify = parseJson(clarifyOutput);
        if (clarify?.needsClarification === true) {
          return {
            mode: 'fixed',
            status: 'needs_clarification',
            clarificationQuestions: clarify.questions ?? [],
            usedAgents,
            steps,
          };
        }
      }

      // ── Step 3: 并行 — 需求分析 + 风险识别 ─────────────────────
      const [analysisOutput, riskOutput] = await Promise.all([
        createAnalysisAgent(this.model).invoke({ extractedRequirement: extractedStr }),
        createRiskAgent(this.model).invoke({ extractedRequirement: extractedStr }),
      ]);
      steps.push({ agent: 'analysisAgent', parallel: true, output: analysisOutput });
      steps.push({ agent: 'riskAgent', parallel: true, output: riskOutput });
      usedAgents.push('analysisAgent', 'riskAgent');

      // ── Step 4: 汇总报告 ────────────────────────────────────────
      const report = await createSummaryAgent(this.model).invoke({
        extractedRequirement: extractedStr,
        analysisResult: analysisOutput,
        riskResult: riskOutput,
      });
      steps.push({ agent: 'summaryAgent', parallel: false, output: report });
      usedAgents.push('summaryAgent');

      return {
        mode: 'fixed',
        status: 'completed',
        usedAgents,
        steps,
        report,
      };
    } catch {
      return {
        mode: 'fixed',
        status: 'failed',
        usedAgents,
        fallback: 'manual_review',
        steps,
      };
    }
  }
}
