import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { createChatModel } from '../model.factory.js';
import { createPostgresSaver } from '../graph/requirement-analysis-graph.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  createPipelineDemoGraph,
  type PipelineDemoStateType,
  type PipelineDemoStep,
  type PipelineDemoStepResult,
} from './pipeline-demo.graph.js';

export type PipelineDemoEvent =
  | { type: 'pipeline_start'; threadId: string }
  | { type: 'plan_created'; plan: PipelineDemoStep[]; retryCount: number }
  | { type: 'step_completed'; result: PipelineDemoStepResult; completed: number; total: number; retryCount: number }
  | { type: 'synthesis_completed'; report: string; retryCount: number }
  | { type: 'evaluation_completed'; pass: boolean; score: number; feedback: string; retryCount: number }
  | { type: 'reflection_completed'; reflection: string; plan: PipelineDemoStep[]; retryCount: number }
  | { type: 'pipeline_complete'; state: PipelineDemoStateType }
  | { type: 'error'; error: string };

export interface PipelineDemoCase {
  id: string;
  title: string;
  description: string;
  tickets: unknown;
}

@Injectable()
export class PipelineDemoService {
  private readonly model: ChatOpenAI;
  private readonly runtimePromise: Promise<{
    graph: ReturnType<typeof createPipelineDemoGraph>;
    checkpointer: Awaited<ReturnType<typeof createPostgresSaver>>;
  }>;

  constructor(
    @Inject(LLM_CONFIG) config: LlmConfig,
    private readonly prisma: PrismaService,
  ) {
    this.model = createChatModel(config);
    this.runtimePromise = createPostgresSaver().then(checkpointer => ({
      graph: createPipelineDemoGraph(checkpointer),
      checkpointer,
    }));
  }

  async listCases(): Promise<PipelineDemoCase[]> {
    return this.prisma.pipeline_test_cases.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, description: true, tickets: true },
    });
  }

  async *stream(caseId: string): AsyncGenerator<PipelineDemoEvent> {
    const testCase = await this.prisma.pipeline_test_cases.findFirst({
      where: { id: caseId, enabled: true },
    });
    if (!testCase) {
      yield { type: 'error', error: `测试案例不存在或已禁用：${caseId}` };
      return;
    }
    const normalizedInput = testCase.input.trim();

    const { graph, checkpointer } = await this.runtimePromise;
    const threadId = `pipeline-demo:${testCase.id}:${randomUUID()}`;
    const config = {
      configurable: {
        thread_id: threadId,
        model: this.model,
        checkpointer,
      },
      streamMode: 'updates' as const,
    };

    yield { type: 'pipeline_start', threadId };

    try {
      const stream = await graph.stream(
        {
          input: normalizedInput,
          parentThreadId: threadId,
          plan: [],
          currentStepIndex: 0,
          stepResults: {},
          reflections: [],
          retryCount: 0,
          finalReport: '',
          evalPass: false,
          evalScore: 0,
          evalFeedback: '',
        },
        config,
      );

      let retryCount = 0;
      for await (const chunk of stream) {
        const [nodeName, update] = Object.entries(
          chunk as Record<string, Partial<PipelineDemoStateType>>,
        )[0] ?? [];
        if (!nodeName || !update) continue;

        if (nodeName === 'planner') {
          yield { type: 'plan_created', plan: update.plan ?? [], retryCount };
          continue;
        }

        if (nodeName === 'executor') {
          const result = Object.values(update.stepResults ?? {})[0];
          if (result) {
            yield {
              type: 'step_completed',
              result,
              completed: update.currentStepIndex ?? 0,
              total: update.plan?.length ?? 0,
              retryCount,
            };
          }
          continue;
        }

        if (nodeName === 'synthesizer') {
          yield {
            type: 'synthesis_completed',
            report: update.finalReport ?? '',
            retryCount,
          };
          continue;
        }

        if (nodeName === 'evaluator') {
          yield {
            type: 'evaluation_completed',
            pass: update.evalPass ?? false,
            score: update.evalScore ?? 0,
            feedback: update.evalFeedback ?? '',
            retryCount,
          };
          continue;
        }

        if (nodeName === 'reflector') {
          retryCount = update.retryCount ?? retryCount + 1;
          yield {
            type: 'reflection_completed',
            reflection: update.reflections?.at(-1) ?? '',
            plan: update.plan ?? [],
            retryCount,
          };
        }
      }

      const snapshot = await graph.getState({ configurable: { thread_id: threadId } });
      yield { type: 'pipeline_complete', state: snapshot.values as PipelineDemoStateType };
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }
}
