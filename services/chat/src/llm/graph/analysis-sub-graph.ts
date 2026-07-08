import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, HumanMessage, SystemMessage, isAIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { analysisTools } from '../tools/analysis-tools.js';
import { createLogger } from '../../observability/logger.js';

export const MAX_TOOL_LOOPS = 6;

const log = createLogger('analysis-subgraph');

// ─── Sub-graph state ──────────────────────────────────────────────────────────

export const AnalysisSubState = Annotation.Root({
  ...MessagesAnnotation.spec,
  toolLoopCount:  Annotation<number>({ reducer: (_, b) => b,             default: () => 0  }),
  analysisResult: Annotation<string>({ reducer: (_, b) => b,             default: () => '' }),
});

export type AnalysisSubStateType = typeof AnalysisSubState.State;

// ─── System prompt ────────────────────────────────────────────────────────────

const AGENT_SYSTEM = `你是一名专业的需求分析师，使用工具收集必要信息后输出完整分析结论。

工具调用规则（严格遵守）：
1. 输入中包含需求编号（REQ-YYYYMMDD-XXX 格式） → 先调用 search_requirement 获取需求详情
2. 需求涉及用户认证、登录、权限管理、文件上传等功能 → 调用 check_conflicts 检测冲突
3. 已获取足够信息后 → 直接输出分析结论，停止调用工具
4. 同一工具不对相同参数重复调用

分析结论必须用 Markdown 格式输出，包含以下章节：
## 功能分解
## 用户故事
## 验收标准
## 技术复杂度评估
## 冲突与依赖`;

// ─── Graph factory ────────────────────────────────────────────────────────────

export function createAnalysisSubGraph(model: ChatOpenAI) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentModel = (model as any).bindTools(analysisTools);
  const rawToolNode = new ToolNode(analysisTools);

  // ── agentNode ─────────────────────────────────────────────────────────────
  const agentNode = async (
    state: AnalysisSubStateType,
  ): Promise<Partial<AnalysisSubStateType>> => {
    log.debug({ toolLoopCount: state.toolLoopCount }, 'analysis_subgraph_agent_start');
    const msgs = [new SystemMessage(AGENT_SYSTEM), ...state.messages];

    // The API proxy hard-cuts cold connections at ~20s. One retry is enough because
    // the first attempt warms the backend; the second attempt typically succeeds.
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = (await agentModel.invoke(msgs)) as AIMessage;
        const names = (response.tool_calls ?? [])
          .map((tc: { name: string }) => tc.name).join(', ');
        if (names) log.debug({ tools: names }, 'analysis_subgraph_will_call_tools');
        return { messages: [response] };
      } catch (e) {
        lastErr = e;
        if (attempt === 1) {
          log.warn({ err: e instanceof Error ? e.message : String(e) }, 'analysis_subgraph_agent_retry');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    throw lastErr;
  };

  // ── toolsNode ─────────────────────────────────────────────────────────────
  const toolsNode = async (
    state: AnalysisSubStateType,
  ): Promise<Partial<AnalysisSubStateType>> => {
    const last = state.messages.at(-1) ?? null;
    const calls = (last && isAIMessage(last) ? (last.tool_calls ?? []) : []) as { name: string }[];
    log.debug(
      { loop: state.toolLoopCount + 1, maxLoops: MAX_TOOL_LOOPS, tools: calls.map(c => c.name) },
      'analysis_subgraph_tools_start',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await rawToolNode.invoke(state)) as any;
    return {
      messages:       result.messages ?? [],
      toolLoopCount:  state.toolLoopCount + 1,
    };
  };

  // ── finalizeNode ──────────────────────────────────────────────────────────
  const finalizeNode = async (
    state: AnalysisSubStateType,
  ): Promise<Partial<AnalysisSubStateType>> => {
    log.info({ totalToolLoops: state.toolLoopCount }, 'analysis_subgraph_finalize');
    const lastAI = [...state.messages]
      .reverse()
      .find((m): m is AIMessage => isAIMessage(m));
    const content = lastAI?.content;
    const analysisResult =
      typeof content === 'string' && content.trim()
        ? content
        : '分析未能完成，请检查 LLM 配置后重试。';
    return { analysisResult };
  };

  // ── router ────────────────────────────────────────────────────────────────
  function routeAfterAgent(state: AnalysisSubStateType): 'tools' | 'finalize' {
    const last = state.messages.at(-1);
    if (!last || !isAIMessage(last)) return 'finalize';
    const aiMsg = last as AIMessage;
    if (!aiMsg.tool_calls?.length) return 'finalize';
    if (state.toolLoopCount >= MAX_TOOL_LOOPS) {
      log.warn({ maxLoops: MAX_TOOL_LOOPS }, 'analysis_subgraph_max_loops_forced_finalize');
      return 'finalize';
    }
    return 'tools';
  }

  return new StateGraph(AnalysisSubState)
    .addNode('agent',    agentNode)
    .addNode('tools',    toolsNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent)
    .addEdge('tools', 'agent')
    .addEdge('finalize', END)
    .compile();
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAnalysisSubGraph(
  model: ChatOpenAI,
  input: string,
): Promise<AnalysisSubStateType> {
  const subGraph = createAnalysisSubGraph(model);
  return subGraph.invoke({
    messages:       [new HumanMessage(input)],
    toolLoopCount:  0,
    analysisResult: '',
  });
}
