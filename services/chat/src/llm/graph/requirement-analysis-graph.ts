import { Annotation, MessagesAnnotation, StateGraph, START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import {
  createExtractAgent,
  createClarifyAgent,
  createRiskAgent,
} from '../agents/sub-agents.js';
import { createAnalysisSubGraph } from './analysis-sub-graph.js';
import { createAnalysisSupervisorSubGraph } from './experts.js';

// ─── State ─────────────────────────────────────────────────────────────────────

export const RequirementAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,
  skipClarification: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  intent:            Annotation<'analyze' | 'query' | 'chat'>({ reducer: (_, b) => b, default: () => 'analyze' }),
  extracted:         Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  clarified:         Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  analysisResult:    Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  toolLoopCount:     Annotation<number>({ reducer: (_, b) => b, default: () => 0  }),
  risk:              Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  summary:           Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  queryResponse:     Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  chatResponse:      Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  // Accumulates per-node error strings so callers can see exactly which step failed.
  nodeErrors:        Annotation<string[]>({ reducer: (a, b) => [...a, ...(b ?? [])], default: () => [] }),
  critique:          Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  reviseCount:       Annotation<number>({ reducer: (_, b) => b, default: () => 0  }),
  // ── 9.2 Supervisor + expert fields (populated when supervisor sub-graph runs) ──
  activeExperts:       Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  functionalAnalysis:  Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  performanceAnalysis: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  securityAnalysis:    Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  complianceAnalysis:  Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
});

export type RequirementState = typeof RequirementAnalysisState.State;

// ─── Classifier schema & keyword fallback ─────────────────────────────────────

const intentSchema = z.object({
  intent: z.enum(['analyze', 'query', 'chat']),
  reasoning: z.string(),
});

const REQ_ID_RE  = /REQ-\d{8}-\d{3}/i;
const QUERY_KW   = ['查询', '查找', '搜索', '看看', '了解', '状态', '进度', '情况', '什么时候'];
const CHAT_KW    = ['你好', '早上好', '晚上好', '谢谢', '请问你', '天气', '帮我聊'];
const ANALYZE_KW = ['分析', '开发', '需要', '实现', '设计', '系统', '功能', '平台', '模块', '建立', '创建'];

export function keywordClassify(text: string): 'analyze' | 'query' | 'chat' {
  const hasReqId   = REQ_ID_RE.test(text);
  const hasAnalyze = ANALYZE_KW.some(k => text.includes(k));
  const hasQuery   = QUERY_KW.some(k => text.includes(k));
  const hasChat    = CHAT_KW.some(k => text.includes(k));

  // Priority 1: REQ ID + query keyword → query (even if "分析" also appears)
  if (hasReqId && hasQuery) return 'query';
  // Priority 2: REQ ID + clear analyze description → analyze
  if (hasReqId && hasAnalyze) return 'analyze';
  // Priority 3: bare REQ ID → query
  if (hasReqId) return 'query';
  // Priority 4: pure chat signals
  if (hasChat && !hasAnalyze) return 'chat';
  // Priority 5: query without analyze
  if (hasQuery && !hasAnalyze) return 'query';
  // Default: analyze
  return 'analyze';
}

// ─── Classifier system prompt ─────────────────────────────────────────────────

const CLASSIFIER_SYSTEM = `你是一个智能意图分类器，将用户输入分类为三种意图之一。

## analyze（需求分析）
触发条件：
- 描述新功能、系统设计或开发任务
- 包含需求编号，但主要意图是进行完整需求分析
关键特征：功能描述、技术需求、"开发"/"实现"/"设计"/"需要"等动词
示例：
- "开发在线问卷系统，支持多种题型"
- "我需要一个用户登录功能"
- "分析需求 REQ-20240315-001：开发在线问卷系统..."（含编号但主要在描述需求内容）

## query（需求查询）
触发条件：
- 查询已有需求/工单的状态、进度或具体信息
- 输入含需求编号（REQ-YYYYMMDD-XXX格式）且不是全量需求描述
- 询问"进度/状态/情况"等查询性词汇
优先级规则：查询词 + 需求编号 → query（即使含"分析"词，"查询"优先级更高）
示例：
- "查询 REQ-20240315-001 的当前状态"
- "REQ-20240415-002 的进度如何"
- "看看 REQ-20240315-001 有没有什么问题"
- "查询 REQ-20240315-001 的风险分析报告"（"查询"优先于"分析"）

## chat（普通闲聊）
触发条件：
- 与需求管理无关的日常对话
- 问候、天气、闲聊等非业务场景
- 无任何业务目标
优先级规则：仅在没有业务信号时才判为 chat
示例：
- "你好，今天天气不错"
- "谢谢你的帮助"

## 边界处理规则（按优先级）
1. 需求编号 + 查询词 → query（最高优先级）
2. 需求编号 + 完整需求描述 → analyze
3. 仅有需求编号 → query
4. 无业务信号 → chat
5. 默认 → analyze`;

// ─── Router ──────────────────────────────────────────────────────────────────

function routeByIntent(state: RequirementState): string {
  if (state.intent === 'query') return 'queryHandler';
  if (state.intent === 'chat')  return 'chatHandler';
  return 'extractStep';
}

// ─── Summary sub-graph (Critic-Refine loop) ───────────────────────────────────

const ACTOR_SYSTEM = `你是资深需求分析师。根据分析和风险评估生成综合报告。

**报告必需章节**：
1. 需求摘要：200-300 字概述
2. 功能分解：主要模块和子功能
3. 冲突分析：与现有需求的冲突点 + 解决方案
4. 技术复杂度：评估（低/中/高）+ 理由
5. 开发排期：各阶段时长 + 依赖项

**格式要求**：
- 使用 Markdown 标题（## 和 ###）
- 关键信息用粗体或列表
- 排期必须标明依赖关系
- 冲突分析必须包含解决方案，不能只描述问题`;

const CRITIC_SYSTEM = `你是资深需求评审专家。按以下标准检查综合报告：

**评审标准**（必须全部满足）：
1. 章节完整性：必须包含"需求摘要"、"冲突分析"、"技术复杂度"、"开发排期"
2. 排期依赖项：排期章节必须标明各阶段的依赖关系（如"前端开发依赖后端 API 完成"）
3. 冲突解决方案：如果存在冲突，必须给出具体解决方案，不能只描述问题
4. 逻辑一致性：各章节之间不能有明显矛盾（如摘要说低复杂度，但技术分析提到大规模重构）

**输出要求**：
- 如果全部满足，返回 pass=true, critique=""
- 如果任一不满足，返回 pass=false，并给出最关键的 1-2 条修改意见
- 修改意见要具体，指出缺少什么或哪里矛盾
- 避免主观性评价（如"语言不够优美"）

**重要**：不要过度严格，只检查核心要素，否则会导致无限循环。`;

const REFINE_SYSTEM = `你是需求分析师。根据评审意见修订报告。

**修订原则**：
1. 只修改被指出的问题部分
2. 未被批评的章节保持不变
3. 补充缺失的章节或内容
4. 修正逻辑矛盾

**禁止行为**：
- 不要重新生成整个报告
- 不要删除正确的内容
- 不要改变原有的结构和风格`;

const criticSchema = z.object({
  pass:     z.boolean().describe('是否通过评审'),
  critique: z.string().describe('不通过时的修改意见，通过时为空'),
  issues:   z.array(z.string()).optional().describe('具体问题列表'),
});

export function createSummarySubGraph(model: ChatOpenAI) {
  const actorNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const input = String(state.messages.at(-1)?.content ?? '');
    const response = await model.invoke([
      new SystemMessage(ACTOR_SYSTEM),
      new HumanMessage(
        `原始需求：${input}\n\n提取结果：${state.extracted}\n\n` +
        `分析结果：${state.analysisResult}\n\n风险评估：${state.risk}\n\n请生成完整的综合报告。`,
      ),
    ]);
    const summary = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    return { summary };
  };

  const criticNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (model as any).withStructuredOutput(criticSchema);
    const result = await structured.invoke([
      new SystemMessage(CRITIC_SYSTEM),
      new HumanMessage(`待评审报告：\n\n${state.summary}\n\n请按标准评审。`),
    ]) as z.infer<typeof criticSchema>;
    console.log(`[Critic] pass=${result.pass}, critique="${result.critique}"`);
    return { critique: result.pass ? '' : result.critique };
  };

  const refineNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const response = await model.invoke([
      new SystemMessage(REFINE_SYSTEM),
      new HumanMessage(
        `原报告：\n\n${state.summary}\n\n评审意见：\n\n${state.critique}\n\n` +
        `请根据评审意见修订报告，只改有问题的地方。`,
      ),
    ]);
    const newCount = state.reviseCount + 1;
    console.log(`[Refine] reviseCount=${newCount}`);
    const summary = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    return { summary, reviseCount: newCount };
  };

  function shouldRefine(state: RequirementState): string {
    if (state.reviseCount >= 2) {
      console.log('[Critic子图] 达到修订上限，强制终止');
      return END;
    }
    if (!state.critique || state.critique.trim() === '') {
      console.log('[Critic子图] 通过评审，完成');
      return END;
    }
    console.log('[Critic子图] 未通过评审，进入 refine');
    return 'refine';
  }

  return new StateGraph(RequirementAnalysisState)
    .addNode('actor',  actorNode)
    .addNode('critic', criticNode)
    .addNode('refine', refineNode)
    .addEdge(START, 'actor')
    .addEdge('actor', 'critic')
    .addConditionalEdges('critic', shouldRefine, {
      [END]:     END,
      'refine': 'refine',
    })
    .addEdge('refine', 'critic')
    .compile();
}

// ─── Nodes ─────────────────────────────────────────────────────────────────────

function buildNodes(model: ChatOpenAI) {
  // ── classifier ───────────────────────────────────────────────────────────────
  const classifierNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const input = String(state.messages.at(-1)?.content ?? '');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const classifierModel = (model as any).withStructuredOutput(intentSchema);
      const result = await classifierModel.invoke([
        new SystemMessage(CLASSIFIER_SYSTEM),
        new HumanMessage(input),
      ]) as z.infer<typeof intentSchema>;
      const validIntents = ['analyze', 'query', 'chat'] as const;
      if (result?.intent && (validIntents as readonly string[]).includes(result.intent)) {
        return { intent: result.intent };
      }
    } catch {
      // fall through to keyword classify
    }
    return { intent: keywordClassify(input) };
  };

  // ── analyze chain ─────────────────────────────────────────────────────────────
  const extractNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const input = String(state.messages.at(-1)?.content ?? '');
    try {
      const extracted = await createExtractAgent(model).invoke({ input });
      return { extracted };
    } catch (e) {
      return { extracted: '', nodeErrors: [`extractStep: ${e instanceof Error ? e.message : String(e)}`] };
    }
  };

  const clarifyNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    if (state.skipClarification) return {};
    try {
      const clarified = await createClarifyAgent(model).invoke({
        extractedRequirement: state.extracted,
      });
      return { clarified };
    } catch (e) {
      return { clarified: '', nodeErrors: [`clarifyStep: ${e instanceof Error ? e.message : String(e)}`] };
    }
  };

  // ── 9.2 Supervisor + multi-expert sub-graph (replaces single-agent ReAct) ──
  // Original single-agent version kept below for reference:
  //   const subGraph = createAnalysisSubGraph(model);
  //   subGraph.invoke({ messages: [...], toolLoopCount: 0, analysisResult: '' })
  const supervisorSubGraph = createAnalysisSupervisorSubGraph(model);
  const analysisNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    try {
      const result = await supervisorSubGraph.invoke({
        extracted:           state.extracted,
        activeExperts:       [],
        functionalAnalysis:  '',
        performanceAnalysis: '',
        securityAnalysis:    '',
        complianceAnalysis:  '',
        analysisResult:      '',
      });
      return {
        analysisResult:      result.analysisResult,
        activeExperts:       result.activeExperts,
        functionalAnalysis:  result.functionalAnalysis,
        performanceAnalysis: result.performanceAnalysis,
        securityAnalysis:    result.securityAnalysis,
        complianceAnalysis:  result.complianceAnalysis,
      };
    } catch (e) {
      return {
        analysisResult: '',
        nodeErrors: [`analysisStep: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  };

  const riskNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    try {
      const risk = await createRiskAgent(model).invoke({
        extractedRequirement: state.extracted,
      });
      return { risk };
    } catch (e) {
      return { risk: '', nodeErrors: [`riskStep: ${e instanceof Error ? e.message : String(e)}`] };
    }
  };

  const summarySubGraph = createSummarySubGraph(model);
  const summaryNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    try {
      const result = await summarySubGraph.invoke({
        ...state,
        summary:     '',
        critique:    '',
        reviseCount: 0,
      });
      return {
        summary:     result.summary,
        critique:    result.critique,
        reviseCount: result.reviseCount,
      };
    } catch (e) {
      return { summary: '', nodeErrors: [`summaryStep: ${e instanceof Error ? e.message : String(e)}`] };
    }
  };

  // ── query handler ─────────────────────────────────────────────────────────────
  const queryHandlerNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const input = String(state.messages.at(-1)?.content ?? '');
    try {
      const result = await model.invoke([
        new SystemMessage(
          '你是需求查询助手。根据用户提供的需求编号或查询条件，简洁地回答关于需求状态、' +
          '进度、负责人等信息的问题。如果没有实际数据，请说明需要连接到需求管理系统获取真实数据，' +
          '并模拟一个合理的查询结果作为示例。',
        ),
        new HumanMessage(input),
      ]);
      const content = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
      return { queryResponse: content, summary: content };
    } catch (e) {
      const msg = `查询服务暂时不可用（${e instanceof Error ? e.message : '未知错误'}），请稍后再试。`;
      return { queryResponse: msg, summary: msg };
    }
  };

  // ── chat handler ──────────────────────────────────────────────────────────────
  const chatHandlerNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const input = String(state.messages.at(-1)?.content ?? '');
    try {
      const result = await model.invoke([
        new SystemMessage('你是友好的AI助手，负责处理与需求管理系统无关的日常对话。请给出简洁、自然的回复。'),
        new HumanMessage(input),
      ]);
      const content = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
      return { chatResponse: content, summary: content };
    } catch (e) {
      const msg = `对话服务暂时不可用（${e instanceof Error ? e.message : '未知错误'}），请稍后再试。`;
      return { chatResponse: msg, summary: msg };
    }
  };

  return {
    classifierNode, extractNode, clarifyNode, analysisNode, riskNode, summaryNode,
    queryHandlerNode, chatHandlerNode,
  };
}

// ─── Graph factory ────────────────────────────────────────────────────────────

export function createAnalysisGraph(model: ChatOpenAI) {
  const {
    classifierNode, extractNode, clarifyNode, analysisNode, riskNode, summaryNode,
    queryHandlerNode, chatHandlerNode,
  } = buildNodes(model);

  return new StateGraph(RequirementAnalysisState)
    .addNode('classifier',   classifierNode)
    .addNode('extractStep',  extractNode)
    .addNode('clarifyStep',  clarifyNode)
    .addNode('analysisStep', analysisNode)
    .addNode('riskStep',     riskNode)
    .addNode('summaryStep',  summaryNode)
    .addNode('queryHandler', queryHandlerNode)
    .addNode('chatHandler',  chatHandlerNode)
    .addEdge(START, 'classifier')
    .addConditionalEdges('classifier', routeByIntent)
    .addEdge('extractStep',  'clarifyStep')
    .addEdge('clarifyStep',  'analysisStep')
    .addEdge('analysisStep', 'riskStep')
    .addEdge('riskStep',     'summaryStep')
    .addEdge('summaryStep',  END)
    .addEdge('queryHandler', END)
    .addEdge('chatHandler',  END)
    .compile();
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAnalysisGraph(
  model: ChatOpenAI,
  input: string,
  skipClarification = false,
): Promise<RequirementState> {
  const app = createAnalysisGraph(model);
  return app.invoke({
    messages: [new HumanMessage(input)],
    skipClarification,
  });
}
