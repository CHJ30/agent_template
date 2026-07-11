import {
  Annotation,
  StateGraph,
  START,
  END,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { createAnalysisGraph } from '../graph/requirement-analysis-graph.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('pipeline-demo');

export interface PipelineDemoStep {
  id: string;
  description: string;
  done: boolean;
}

export interface PipelineDemoStepResult {
  stepId: string;
  description: string;
  output: string;
  activeExperts: string[];
  durationMs: number;
  error?: string;
}

export const PipelineDemoState = Annotation.Root({
  input: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  parentThreadId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  plan: Annotation<PipelineDemoStep[]>({ reducer: (_, b) => b, default: () => [] }),
  currentStepIndex: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  stepResults: Annotation<Record<string, PipelineDemoStepResult>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  reflections: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  retryCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  finalReport: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  evalPass: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  evalScore: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  evalFeedback: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
});

export type PipelineDemoStateType = typeof PipelineDemoState.State;

const planItemSchema = z.object({
  id: z.string().describe('稳定且简短的步骤 ID，例如 step-1'),
  description: z.string().min(10).describe('可直接交给需求分析 Graph 的完整任务描述'),
});

const plannerSchema = z.object({
  steps: z.array(planItemSchema).min(1).max(5),
});

const evaluationSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(10),
  feedback: z.string(),
});

const reflectionSchema = z.object({
  reflection: z.string().describe('本轮未达标的根因和修订思路'),
  steps: z.array(planItemSchema).min(1).max(5),
});

const PLANNER_SYSTEM = `你是跨工单联合分析的规划者。把复杂任务拆成 1-5 个可以独立执行的需求分析步骤。

规则：
1. 每步必须包含足够上下文，可以直接交给独立的需求分析工作流；
2. 优先按工单或业务能力拆分，必要时增加一个跨工单冲突专项步骤；
3. 不要创建“汇总报告”步骤，汇总由后续 Synthesizer 完成；
4. 步骤 ID 必须唯一且稳定。`;

const SYNTHESIZER_SYSTEM = `你是跨工单联合分析专家。根据每个步骤的完整分析报告生成联合报告。

报告必须包含：
## 联合分析摘要
## 各工单核心结论
## 跨工单依赖与执行顺序
## 共享组件与可复用能力
## 冲突与资源竞争
## 整体风险和落地建议

要求明确指出不同步骤之间的关系，而不是简单拼接原报告。`;

const EVALUATOR_SYSTEM = `你是联合需求报告评审者。按以下标准评分：
1. 所有计划步骤都有实质结论；
2. 报告包含跨工单依赖、冲突和整体建议；
3. 不同步骤的结论不存在明显矛盾；
4. 报告可以指导实施顺序。

全部达到基本可用水平才 pass=true。不要因措辞风格等非核心问题判定失败。`;

const REFLECTOR_SYSTEM = `你是 Plan-and-Execute 流水线的反思节点。根据评估反馈修订执行计划。

规则：
1. 分析失败根因是步骤遗漏、描述不清还是拆分不合理；
2. 保留有效步骤，细化或替换有问题的步骤；
3. 所有步骤都会整链重跑，因此返回的每一步 done 都会被重置；
4. 修订后仍限制为 1-5 步。`;

function getModel(config: RunnableConfig, node: string): ChatOpenAI {
  const model = config.configurable?.model as ChatOpenAI | undefined;
  if (!model) throw new Error(`[pipeline-demo:${node}] config.configurable.model 缺失`);
  return model;
}

function getCheckpointer(config: RunnableConfig): BaseCheckpointSaver | undefined {
  return config.configurable?.checkpointer as BaseCheckpointSaver | undefined;
}

function resultKey(retryCount: number, stepId: string): string {
  return `r${retryCount}:${stepId}`;
}

function currentRoundResults(state: PipelineDemoStateType): PipelineDemoStepResult[] {
  return state.plan
    .map(step => state.stepResults[resultKey(state.retryCount, step.id)])
    .filter((result): result is PipelineDemoStepResult => Boolean(result));
}

async function plannerNode(
  state: PipelineDemoStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineDemoStateType>> {
  const model = getModel(config, 'planner');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const structured = (model as any).withStructuredOutput(plannerSchema);
  const result = await structured.invoke([
    new SystemMessage(PLANNER_SYSTEM),
    new HumanMessage(`请规划以下跨工单联合分析任务：\n\n${state.input}`),
  ]) as z.infer<typeof plannerSchema>;

  const plan = result.steps.map((step, index) => ({
    id: step.id.trim() || `step-${index + 1}`,
    description: step.description.trim(),
    done: false,
  }));
  log.info({ parentThreadId: state.parentThreadId, steps: plan.length }, 'plan_created');
  return { plan, currentStepIndex: 0 };
}

async function executorNode(
  state: PipelineDemoStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineDemoStateType>> {
  const model = getModel(config, 'executor');
  const step = state.plan[state.currentStepIndex];
  if (!step) throw new Error(`执行步骤不存在: index=${state.currentStepIndex}`);

  const childThreadId =
    `${state.parentThreadId}:r${state.retryCount}:step-${state.currentStepIndex}`;
  const startedAt = Date.now();
  let stepResult: PipelineDemoStepResult;

  try {
    const analysisGraph = createAnalysisGraph(model, getCheckpointer(config));
    const result = await analysisGraph.invoke(
      {
        messages: [new HumanMessage(step.description)],
        skipClarification: true,
        humanReviewEnabled: false,
      },
      { configurable: { thread_id: childThreadId } },
    );
    stepResult = {
      stepId: step.id,
      description: step.description,
      output: result.summary || result.analysisResult || '该步骤未生成分析结果。',
      activeExperts: result.activeExperts ?? [],
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stepResult = {
      stepId: step.id,
      description: step.description,
      output: `[ERROR] ${message}`,
      activeExperts: [],
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }

  const plan = state.plan.map((item, index) =>
    index === state.currentStepIndex ? { ...item, done: true } : item,
  );
  log.info(
    { stepId: step.id, childThreadId, durationMs: stepResult.durationMs },
    'step_completed',
  );
  return {
    plan,
    currentStepIndex: state.currentStepIndex + 1,
    stepResults: { [resultKey(state.retryCount, step.id)]: stepResult },
  };
}

function routeAfterExecutor(state: PipelineDemoStateType): 'executor' | 'synthesizer' {
  return state.currentStepIndex < state.plan.length ? 'executor' : 'synthesizer';
}

async function synthesizerNode(
  state: PipelineDemoStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineDemoStateType>> {
  const model = getModel(config, 'synthesizer');
  const results = currentRoundResults(state);
  const material = results.map(result =>
    `## ${result.stepId}\n任务：${result.description}\n参与专家：${result.activeExperts.join('、') || '未知'}\n\n${result.output.slice(0, 8_000)}`,
  ).join('\n\n---\n\n');

  const response = await model.invoke([
    new SystemMessage(SYNTHESIZER_SYSTEM),
    new HumanMessage(`原始联合任务：\n${state.input}\n\n各步骤结果：\n\n${material}`),
  ]);
  const finalReport = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
  return { finalReport };
}

async function evaluatorNode(
  state: PipelineDemoStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineDemoStateType>> {
  const model = getModel(config, 'evaluator');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const structured = (model as any).withStructuredOutput(evaluationSchema);
  const result = await structured.invoke([
    new SystemMessage(EVALUATOR_SYSTEM),
    new HumanMessage(
      `原始任务：\n${state.input}\n\n计划步骤：\n${state.plan.map(s => `- ${s.id}: ${s.description}`).join('\n')}\n\n联合报告：\n${state.finalReport.slice(0, 12_000)}`,
    ),
  ]) as z.infer<typeof evaluationSchema>;
  log.info({ pass: result.pass, score: result.score }, 'evaluation_completed');
  return {
    evalPass: result.pass,
    evalScore: result.score,
    evalFeedback: result.feedback,
  };
}

function routeAfterEvaluator(state: PipelineDemoStateType): 'reflector' | typeof END {
  if (state.evalPass || state.retryCount >= 1) return END;
  return 'reflector';
}

async function reflectorNode(
  state: PipelineDemoStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineDemoStateType>> {
  const model = getModel(config, 'reflector');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const structured = (model as any).withStructuredOutput(reflectionSchema);
  const result = await structured.invoke([
    new SystemMessage(REFLECTOR_SYSTEM),
    new HumanMessage(
      `原始任务：\n${state.input}\n\n当前计划：\n${JSON.stringify(state.plan)}\n\n` +
      `评估分数：${state.evalScore}\n评估反馈：${state.evalFeedback}\n\n请反思并修订计划。`,
    ),
  ]) as z.infer<typeof reflectionSchema>;

  const plan = result.steps.map((step, index) => ({
    id: step.id.trim() || `step-${index + 1}`,
    description: step.description.trim(),
    done: false,
  }));
  return {
    plan,
    currentStepIndex: 0,
    retryCount: state.retryCount + 1,
    reflections: [result.reflection],
    evalPass: false,
    evalScore: 0,
    evalFeedback: '',
  };
}

export function createPipelineDemoGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(PipelineDemoState)
    .addNode('planner', plannerNode)
    .addNode('executor', executorNode)
    .addNode('synthesizer', synthesizerNode)
    .addNode('evaluator', evaluatorNode)
    .addNode('reflector', reflectorNode)
    .addEdge(START, 'planner')
    .addEdge('planner', 'executor')
    // LangGraph's current TS inference does not preserve string-array route maps.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addConditionalEdges('executor', routeAfterExecutor as any, {
      executor: 'executor',
      synthesizer: 'synthesizer',
    })
    .addEdge('synthesizer', 'evaluator')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addConditionalEdges('evaluator', routeAfterEvaluator as any, {
      reflector: 'reflector',
      [END]: END,
    })
    .addEdge('reflector', 'executor')
    .compile({ checkpointer });
}

