/**
 * Chapter 10 — Plan-and-Execute Pipeline
 *
 * Wraps the full analysis graph (9.2/9.3) with a Planner → Executor → Evaluator
 * → [Reflector → Executor] loop for cross-ticket joint analysis.
 *
 * Graph topology:
 *
 *   START → planner ──► executor ◄─────────────────────┐
 *                          │ (loop until all steps done) │
 *                          ▼                             │
 *                      evaluator                         │
 *                          │                             │
 *             pass? ◄──────┤──────► reflector ───────────┘
 *               │          │ (retryCount >= 1 → force pass)
 *              END         │
 *
 * When to use pipeline vs. direct analysis:
 *   - Direct (createAnalysisGraph / runAnalysisGraph):
 *       Single requirement, one-shot analysis, interactive chat
 *   - Pipeline (createPipeline / runPipeline):
 *       Cross-ticket joint analysis (2-5 tickets at once)
 *       Automatic quality gate + 1-cycle Reflexion retry
 *       Multi-phase work (e.g., analyse 5 requirements sequentially)
 */

import {
  Annotation,
  StateGraph,
  START,
  END,
  MemorySaver,
} from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { createAnalysisGraph } from './requirement-analysis-graph.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface PipelineStep {
  id:          string;
  description: string;
  done:        boolean;
}

// ─── PipelineState ────────────────────────────────────────────────────────────
//
// stepResults key convention: "r{retryCount}:{stepId}"
// Using retryCount in the key means the reflector never has to clear previous
// results — it just increments retryCount and the new round uses new keys.

export const PipelineState = Annotation.Root({
  // ── inputs ──
  input:          Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  parentThreadId: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  // ── planner outputs ──
  plan:             Annotation<PipelineStep[]>({ reducer: (_, b) => b, default: () => [] }),
  currentStepIndex: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  // ── executor outputs (keyed by "r{retryCount}:{stepId}") ──
  stepResults: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  // ── evaluator outputs ──
  finalReport:  Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  evalPass:     Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  evalFeedback: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  // ── reflector outputs ──
  reflections: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  retryCount:  Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
});

export type PipelineStateType = typeof PipelineState.State;

// ─── System prompts ───────────────────────────────────────────────────────────

const PLANNER_SYSTEM = `你是资深需求分析主管，负责将复杂的跨工单联合分析任务拆解为有序的独立分析步骤。

**拆解原则**：
1. 每个步骤对应一个独立的需求工单或分析维度，可以单独分析
2. 步骤之间尽量减少依赖（避免"步骤3依赖步骤1结论"）
3. 步骤数量控制在 2-5 步
4. 每步的描述必须完整、可以直接作为单条需求输入给分析师

**输出格式（严格 JSON 数组，只输出 JSON）**：
[
  { "id": "step-1", "description": "完整的需求描述...", "done": false },
  { "id": "step-2", "description": "完整的需求描述...", "done": false }
]`;

const SYNTHESIZER_SYSTEM = `你是需求分析总结专家。将多个需求的独立分析结果整合为一份联合分析报告。

**报告结构**：
## 联合分析摘要
各需求的共同目标与整体背景

## 各需求分析结论
按需求逐一列出核心结论（摘录，非全文）

## 跨需求关联分析
- 共同技术组件与可复用模块
- 需求间的依赖关系与执行顺序
- 潜在冲突点及解决建议

## 整体风险与建议
综合所有需求的技术风险、合规风险和整体开发建议`;

const EVALUATOR_SYSTEM = `你是资深需求分析评审专家，评估跨工单联合分析报告的质量。

**评审标准**（全部满足才通过）：
1. 覆盖率：每个分析步骤都有实质内容（非空，非纯错误信息）
2. 有效性：各步骤输出 > 100 字符
3. 一致性：各步骤结论之间无明显矛盾
4. 联合报告质量：包含跨需求关联分析和整体建议

**重要**：标准合理，不要过度苛刻；实质内容存在即通过。

**输出格式（JSON）**：{ "pass": true/false, "score": 0-10, "feedback": "简短反馈" }`;

const REFLECTOR_SYSTEM = `你是资深需求分析主管，在分析质量不达标时修订分析计划。

**修订原则**：
1. 根据评估反馈找出根本原因（是步骤描述不清？还是步骤拆解不合理？）
2. 保留效果好的步骤，只修改/细化有问题的步骤
3. 可以将模糊步骤拆分为更具体的子步骤
4. 步骤总数不超过 5 步

**输出格式（严格 JSON 数组，只输出 JSON）**：
[{ "id": "step-1", "description": "...", "done": false }, ...]`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJson(content: string): string {
  const cleaned = content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  return arrMatch ? arrMatch[0] : cleaned;
}

function parsePlan(content: string): PipelineStep[] | null {
  try {
    const parsed = JSON.parse(extractJson(content));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((s: Record<string, unknown>, i: number) => ({
      id:          typeof s.id === 'string' ? s.id : `step-${i + 1}`,
      description: typeof s.description === 'string' ? s.description : '',
      done:        false,
    }));
  } catch {
    return null;
  }
}

function stepKey(retryCount: number, stepId: string): string {
  return `r${retryCount}:${stepId}`;
}

function getCurrentRoundResults(
  state: PipelineStateType,
): Array<{ stepId: string; result: string }> {
  return state.plan.map(s => ({
    stepId: s.id,
    result: state.stepResults[stepKey(state.retryCount, s.id)] ?? '',
  }));
}

// ─── plannerNode ──────────────────────────────────────────────────────────────
// Receives the raw multi-ticket task and uses LLM to produce an ordered plan.

async function plannerNode(
  state: PipelineStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const model = config?.configurable?.model as ChatOpenAI | undefined;
  if (!model) throw new Error('[pipeline:planner] model not provided in config.configurable');

  console.log('[pipeline:planner] 开始拆解任务…');
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await model.invoke([
        new SystemMessage(PLANNER_SYSTEM),
        new HumanMessage(`请将以下联合分析任务拆解为有序步骤：\n\n${state.input}`),
      ]);
      const content = typeof response.content === 'string' ? response.content : '';
      const plan = parsePlan(content);
      if (plan) {
        console.log(`[pipeline:planner] 计划 ${plan.length} 步: [${plan.map(s => s.id).join(', ')}]`);
        return { plan, currentStepIndex: 0 };
      }
      throw new Error('LLM 返回了无效的 JSON 计划');
    } catch (e) {
      lastErr = e;
      if (attempt === 1) {
        console.log(`[pipeline:planner] attempt 1 失败 (${e instanceof Error ? e.message : e})，2s 后重试…`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // Fallback: treat the entire input as a single step
  console.log(`[pipeline:planner] 解析失败，降级为单步计划: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  return {
    plan:             [{ id: 'step-1', description: state.input, done: false }],
    currentStepIndex: 0,
  };
}

// ─── executorNode ─────────────────────────────────────────────────────────────
// Executes plan[currentStepIndex] by invoking the full 9.2/9.3 analysis graph.
// Each step gets its own thread_id for independent sub-task persistence.

async function executorNode(
  state: PipelineStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const model = config?.configurable?.model as ChatOpenAI | undefined;
  if (!model) throw new Error('[pipeline:executor] model not provided in config.configurable');

  // Shared checkpointer for all sub-steps (different thread_ids give isolation).
  const checkpointer = (config?.configurable?.checkpointer as MemorySaver | undefined)
    ?? new MemorySaver();

  const step      = state.plan[state.currentStepIndex];
  const threadId  = `${state.parentThreadId}:r${state.retryCount}:step-${state.currentStepIndex}`;

  console.log(
    `[pipeline:executor] 执行 ${step.id} (${state.currentStepIndex + 1}/${state.plan.length}), ` +
    `thread=${threadId}`,
  );

  let stepOutput = '';
  try {
    // Call the full 9.2/9.3 analysis graph with per-step checkpointing.
    const analysisGraph = createAnalysisGraph(model, checkpointer);
    const result = await analysisGraph.invoke(
      {
        messages:          [new HumanMessage(step.description)],
        skipClarification: true,
      },
      { configurable: { thread_id: threadId } },
    );
    stepOutput = result.summary || result.analysisResult || '';
    console.log(`[pipeline:executor] ${step.id} 完成 (${stepOutput.length} 字符)`);
  } catch (e) {
    stepOutput = `[ERROR] ${step.id} 执行失败: ${e instanceof Error ? e.message : String(e)}`;
    console.log(`[pipeline:executor] ${step.id} 失败: ${e instanceof Error ? e.message : e}`);
  }

  const updatedPlan = state.plan.map((s, i) =>
    i === state.currentStepIndex ? { ...s, done: true } : s,
  );

  return {
    plan:             updatedPlan,
    stepResults:      { [stepKey(state.retryCount, step.id)]: stepOutput },
    currentStepIndex: state.currentStepIndex + 1,
  };
}

// ─── routeAfterExecutor ───────────────────────────────────────────────────────

function routeAfterExecutor(state: PipelineStateType): 'executor' | 'evaluator' {
  if (state.currentStepIndex < state.plan.length) {
    return 'executor';   // still more steps to run
  }
  return 'evaluator';    // all steps done → evaluate
}

// ─── evaluatorNode ────────────────────────────────────────────────────────────
// 1. Synthesizes all step results into a final joint report.
// 2. Assesses report quality and sets evalPass / evalFeedback.

async function evaluatorNode(
  state: PipelineStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const model = config?.configurable?.model as ChatOpenAI | undefined;
  if (!model) throw new Error('[pipeline:evaluator] model not provided in config.configurable');

  const roundResults = getCurrentRoundResults(state);
  console.log(
    `[pipeline:evaluator] 评估第 ${state.retryCount} 轮，共 ${roundResults.length} 步结果`,
  );

  // ── Step 1: synthesize a joint report ─────────────────────────────────────
  const stepSummary = state.plan.map(s => {
    const r = roundResults.find(rr => rr.stepId === s.id);
    return `### ${s.id}\n**需求描述**: ${s.description.slice(0, 200)}\n\n**分析结论**:\n${r?.result ?? '（无结果）'}`;
  }).join('\n\n---\n\n');

  let finalReport = '';
  try {
    const reportResp = await model.invoke([
      new SystemMessage(SYNTHESIZER_SYSTEM),
      new HumanMessage(
        `原始任务：\n${state.input}\n\n各步骤分析结果：\n\n${stepSummary}`,
      ),
    ]);
    finalReport = typeof reportResp.content === 'string' ? reportResp.content : '';
    console.log(`[pipeline:evaluator] 综合报告生成完成 (${finalReport.length} 字符)`);
  } catch (e) {
    finalReport = `[SYNTHESIS ERROR] ${e instanceof Error ? e.message : String(e)}\n\n${stepSummary}`;
    console.log(`[pipeline:evaluator] 综合报告生成失败: ${e instanceof Error ? e.message : e}`);
  }

  // ── Step 2: evaluate quality ───────────────────────────────────────────────
  const evalSchema = z.object({
    pass:     z.boolean(),
    score:    z.number().min(0).max(10),
    feedback: z.string(),
  });

  let evalPass = false;
  let evalFeedback = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (model as any).withStructuredOutput(evalSchema);
    const stepSummaryShort = roundResults
      .map(r => `${r.stepId}: ${r.result.slice(0, 150)}`)
      .join('\n');
    const evalResult = await structured.invoke([
      new SystemMessage(EVALUATOR_SYSTEM),
      new HumanMessage(
        `原始任务：\n${state.input}\n\n各步骤结果摘要：\n${stepSummaryShort}\n\n综合报告（前 800 字）：\n${finalReport.slice(0, 800)}`,
      ),
    ]) as z.infer<typeof evalSchema>;
    evalPass     = evalResult.pass;
    evalFeedback = evalResult.feedback;
    console.log(
      `[pipeline:evaluator] pass=${evalPass}, score=${evalResult.score}, feedback="${evalFeedback}"`,
    );
  } catch (e) {
    // Default to pass on evaluator failure — prevents infinite loop on eval errors.
    evalPass     = true;
    evalFeedback = `评估节点异常 (${e instanceof Error ? e.message : String(e)})，默认通过`;
    console.log(`[pipeline:evaluator] 评估失败，默认通过: ${e instanceof Error ? e.message : e}`);
  }

  return { finalReport, evalPass, evalFeedback };
}

// ─── routeAfterEvaluator ──────────────────────────────────────────────────────
// Hard limit: retryCount >= 1 forces exit regardless of evalPass.

function routeAfterEvaluator(state: PipelineStateType): 'reflector' | typeof END {
  if (state.evalPass) {
    console.log('[pipeline] 质量通过，输出最终报告');
    return END;
  }
  if (state.retryCount >= 1) {
    console.log('[pipeline] 达到重试上限（1 次），强制终止');
    return END;
  }
  console.log('[pipeline] 质量不达标，进入反思修订循环');
  return 'reflector';
}

// ─── reflectorNode ────────────────────────────────────────────────────────────
// Analyses why evaluation failed and revises the plan.
// Resets currentStepIndex so executor re-runs from step 0 with a new plan.

async function reflectorNode(
  state: PipelineStateType,
  config: RunnableConfig,
): Promise<Partial<PipelineStateType>> {
  const model = config?.configurable?.model as ChatOpenAI | undefined;
  if (!model) throw new Error('[pipeline:reflector] model not provided in config.configurable');

  console.log(`[pipeline:reflector] 反思修订 (retryCount=${state.retryCount})…`);

  const roundResults = getCurrentRoundResults(state);
  const prevResultsSummary = roundResults
    .map(r => `${r.stepId}: ${r.result.slice(0, 200)}`)
    .join('\n');

  const reflection =
    `第 ${state.retryCount + 1} 轮反思\n` +
    `评估反馈：${state.evalFeedback}\n` +
    `上一轮各步结果摘要：\n${prevResultsSummary}`;

  let newPlan = state.plan.map(s => ({ ...s, done: false })); // default: keep existing plan, reset done flags
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await model.invoke([
        new SystemMessage(REFLECTOR_SYSTEM),
        new HumanMessage(
          `原始任务：\n${state.input}\n\n` +
          `当前计划：\n${JSON.stringify(state.plan, null, 2)}\n\n` +
          `评估不达标原因：\n${state.evalFeedback}\n\n` +
          `上一轮各步结果摘要：\n${prevResultsSummary}\n\n` +
          `请修订分析计划。`,
        ),
      ]);
      const content = typeof response.content === 'string' ? response.content : '';
      const revised = parsePlan(content);
      if (revised) {
        newPlan = revised;
        console.log(`[pipeline:reflector] 修订后计划: [${newPlan.map(s => s.id).join(', ')}]`);
        break;
      }
      throw new Error('LLM 返回了无效的修订计划 JSON');
    } catch (e) {
      lastErr = e;
      if (attempt === 1) {
        console.log(`[pipeline:reflector] attempt 1 失败 (${e instanceof Error ? e.message : e})，2s 后重试…`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (lastErr) {
    console.log(`[pipeline:reflector] 修订失败，复用原计划重试: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  }

  return {
    plan:             newPlan,
    currentStepIndex: 0,            // re-run from the first step
    retryCount:       state.retryCount + 1,
    reflections:      [reflection],
    evalPass:         false,
    evalFeedback:     '',
  };
}

// ─── Graph factory ────────────────────────────────────────────────────────────
//
// The pipeline graph is stateless — model is injected at runtime via
// config.configurable so the same compiled graph can serve different models.

export function createPipeline() {
  return new StateGraph(PipelineState)
    .addNode('planner',   plannerNode)
    .addNode('executor',  executorNode)
    .addNode('evaluator', evaluatorNode)
    .addNode('reflector', reflectorNode)
    .addEdge(START, 'planner')
    .addEdge('planner',   'executor')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addConditionalEdges('executor', routeAfterExecutor as any, {
      executor:  'executor',
      evaluator: 'evaluator',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addConditionalEdges('evaluator', routeAfterEvaluator as any, {
      reflector: 'reflector',
      [END]:     END,
    })
    .addEdge('reflector', 'executor')
    .compile();
}

// ─── Runner ───────────────────────────────────────────────────────────────────
//
// Usage:
//   const result = await runPipeline(model, input, 'pipeline-20241226-001');
//   console.log(result.finalReport);

export async function runPipeline(
  model:           ChatOpenAI,
  input:           string,
  parentThreadId?: string,
): Promise<PipelineStateType> {
  const pipeline     = createPipeline();
  const checkpointer = new MemorySaver(); // shared across all sub-steps
  const threadId     = parentThreadId ?? `pipeline-${Date.now()}`;

  console.log(`[pipeline] 启动 (thread=${threadId})`);
  const result = await pipeline.invoke(
    {
      input,
      parentThreadId: threadId,
      plan:             [],
      currentStepIndex: 0,
      stepResults:      {},
      reflections:      [],
      retryCount:       0,
      finalReport:      '',
      evalPass:         false,
      evalFeedback:     '',
    },
    {
      configurable: {
        model,
        checkpointer, // passed to executorNode for sub-graph checkpointing
      },
    },
  );

  console.log(
    `[pipeline] 完成 (evalPass=${result.evalPass}, retryCount=${result.retryCount}, ` +
    `report=${result.finalReport.length} 字符)`,
  );
  return result;
}
