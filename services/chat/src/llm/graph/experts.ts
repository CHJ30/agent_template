import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  isAIMessage,
} from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import {
  searchRequirementTool,
  checkConflictsTool,
  loadPerfBaselineTool,
  checkPerfBudgetTool,
  checkSecurityPolicyTool,
} from '../tools/analysis-tools.js';

// ─── Tool type union ─────────────────────────────────────────────────────────

type ExpertTool =
  | typeof searchRequirementTool
  | typeof checkConflictsTool
  | typeof loadPerfBaselineTool
  | typeof checkPerfBudgetTool
  | typeof checkSecurityPolicyTool;

// ─── Expert sub-graph state (isolated per expert) ─────────────────────────────
// These messages are NEVER written back to the parent graph state.

const ExpertSubState = Annotation.Root({
  ...MessagesAnnotation.spec,
  expertOutput:    Annotation<string>({ reducer: (_, b) => b,         default: () => ''  }),
  expertLoopCount: Annotation<number>({ reducer: (_, b) => b,         default: () => 0   }),
  // Accumulates every tool name called during this sub-graph invocation.
  toolCallLog:     Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
});

type ExpertSubStateType = typeof ExpertSubState.State;

export const MAX_EXPERT_LOOPS = 3;

// ─── createExpertSubGraph ─────────────────────────────────────────────────────
// Generic ReAct loop: agent ↔ tools (up to MAX_EXPERT_LOOPS), then finalize.
// Only `expertOutput` and `toolCallLog` propagate back to the caller.

export function createExpertSubGraph(
  model: ChatOpenAI,
  tools: ExpertTool[],
  systemPrompt: string,
  name: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentModel = (model as any).bindTools(tools);
  const rawToolNode = new ToolNode(tools);

  // ── agentNode: 2 attempts; after final failure, degrade gracefully ─────────
  const agentNode = async (
    state: ExpertSubStateType,
  ): Promise<Partial<ExpertSubStateType>> => {
    const msgs = [new SystemMessage(systemPrompt), ...state.messages];
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = (await agentModel.invoke(msgs)) as AIMessage;
        return { messages: [response] };
      } catch (e) {
        lastErr = e;
        if (attempt === 1) {
          console.log(
            `[expert-subgraph:${name}] attempt 1 failed (${e instanceof Error ? e.message : e}), retrying in 2s…`,
          );
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    // Both attempts failed → synthetic degradation message so graph can finish.
    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.log(`[expert-subgraph:${name}] 两次尝试均失败，降级输出`);
    return {
      messages: [
        new AIMessage(
          `[${name} 专家暂不可用：${errMsg}] 本项分析已跳过，建议人工补充。`,
        ),
      ],
    };
  };

  // ── toolsNode ─────────────────────────────────────────────────────────────
  const toolsNode = async (
    state: ExpertSubStateType,
  ): Promise<Partial<ExpertSubStateType>> => {
    const last = state.messages.at(-1) ?? null;
    const calls = (last && isAIMessage(last) ? (last.tool_calls ?? []) : []) as { name: string }[];
    const newToolNames = calls.map(c => c.name);
    console.log(
      `[expert-subgraph] → tools (loop ${state.expertLoopCount + 1}/${MAX_EXPERT_LOOPS}) [${newToolNames.join(', ')}]`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await rawToolNode.invoke(state)) as any;
    return {
      messages:        result.messages ?? [],
      expertLoopCount: state.expertLoopCount + 1,
      toolCallLog:     newToolNames, // concat reducer appends to accumulated log
    };
  };

  // ── finalizeNode ──────────────────────────────────────────────────────────
  const finalizeNode = async (
    state: ExpertSubStateType,
  ): Promise<Partial<ExpertSubStateType>> => {
    const lastAI = [...state.messages]
      .reverse()
      .find((m): m is AIMessage => isAIMessage(m));
    const content = lastAI?.content;
    const expertOutput =
      typeof content === 'string' && content.trim()
        ? content
        : '专家分析未能完成，请检查 LLM 配置。';
    return { expertOutput };
  };

  // ── routeAfterAgent ───────────────────────────────────────────────────────
  function routeAfterAgent(state: ExpertSubStateType): 'tools' | 'finalize' {
    const last = state.messages.at(-1) ?? null;
    if (!last || !isAIMessage(last)) return 'finalize';
    const aiMsg = last as AIMessage;
    if (!aiMsg.tool_calls?.length) return 'finalize';
    if (state.expertLoopCount >= MAX_EXPERT_LOOPS) {
      console.log(`[expert-subgraph] max loops (${MAX_EXPERT_LOOPS}) reached → forcing finalize`);
      return 'finalize';
    }
    return 'tools';
  }

  return new StateGraph(ExpertSubState)
    .addNode('agent',    agentNode)
    .addNode('tools',    toolsNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent)
    .addEdge('tools', 'agent')
    .addEdge('finalize', END)
    .compile();
}

// ─── Expert system prompts ────────────────────────────────────────────────────

const FUNCTIONAL_SYSTEM = `你是功能需求分析专家，专注于功能分解、用户故事和接口设计。

**工具使用规则**：
1. 输入含需求编号（REQ-YYYYMMDD-XXX）→ 先调用 search_requirement 获取完整需求详情
2. 识别到可能的功能冲突或重叠 → 调用 check_conflicts 检测
3. 获取足够信息后直接输出分析，停止调用工具；同一工具不对相同参数重复调用

**输出格式（Markdown）**：

## 功能分解
列出主要功能模块与子功能（层级结构）

## 用户故事
核心场景：As a <角色> I want <功能> So that <价值>

## 接口设计要点
主要 API 端点与关键数据结构建议

## 冲突与依赖
与现有需求/系统的冲突点及处理建议（无冲突则写"无已知冲突"）`;

const PERFORMANCE_SYSTEM = `你是性能与架构分析专家，专注于非功能性需求和技术架构评估。

**工具使用规则**：
1. 始终调用 load_perf_baseline 获取相关场景的历史性能基线（传入最接近的场景关键词，如"批量导入"、"数据导出"）
2. 识别到具体并发量或响应时间指标 → 调用 check_perf_budget 验证是否超出预算
3. 输入含需求编号 → 先调用 search_requirement 了解需求规模和现有背景
4. 获取足够信息后直接输出分析，停止调用工具；同一工具不对相同参数重复调用

**输出格式（Markdown）**：

## 性能需求识别
并发量估算、响应时间要求（P99）、数据规模

## 技术复杂度评估
- **总体评级**：低 / 中 / 高
- 评级依据（关键技术挑战）

## 架构风险
主要技术瓶颈和潜在扩展问题

## 扩展性建议
横向/纵向扩展策略及关键组件设计建议`;

const SECURITY_SYSTEM = `你是安全与权限分析专家，专注于认证鉴权、数据安全和接口安全。

**工具使用规则**：
1. 始终调用 check_security_policy 检查该需求适用的安全策略清单
2. 输入含需求编号 → 调用 search_requirement 获取需求背景
3. 需求涉及认证、权限、文件上传、敏感数据等 → 调用 check_conflicts 检测现有安全模块冲突
4. 获取足够信息后直接输出分析，停止调用工具；同一工具不对相同参数重复调用

**输出格式（Markdown）**：

## 安全需求识别
认证方式、权限粒度、数据敏感级别

## 适用安全策略
来自 check_security_policy 的策略清单及执行要求

## 已知冲突与复用建议
check_conflicts 检测结果，以及推荐的复用方案

## 安全风险评估
主要安全威胁（对照 OWASP Top 10）

## 安全控制措施
推荐的安全设计决策（加密、脱敏、审计日志等）`;

const COMPLIANCE_SYSTEM = `你是合规与数据治理专家，专注于法规合规、个人信息保护和审计要求。

**工具使用规则**：
1. 输入含需求编号 → 调用 search_requirement 了解数据类型和业务背景
2. 获取足够信息后直接输出分析，停止调用工具

**输出格式（Markdown）**：

## 数据合规要求
适用法规（GDPR / 个人信息保护法 / 行业规范）与合规义务

## 个人信息处理
数据收集最小化、存储期限、使用授权、删除机制

## 审计与日志
需要记录的操作日志类型、审计追踪要求

## 合规风险
主要合规差距与整改优先级建议`;

// ─── Expert factories ─────────────────────────────────────────────────────────

export function createFunctionalExpert(model: ChatOpenAI) {
  return createExpertSubGraph(
    model,
    [searchRequirementTool, checkConflictsTool],
    FUNCTIONAL_SYSTEM,
    'functional',
  );
}

export function createPerformanceExpert(model: ChatOpenAI) {
  return createExpertSubGraph(
    model,
    [searchRequirementTool, loadPerfBaselineTool, checkPerfBudgetTool],
    PERFORMANCE_SYSTEM,
    'performance',
  );
}

export function createSecurityExpert(model: ChatOpenAI) {
  return createExpertSubGraph(
    model,
    [searchRequirementTool, checkConflictsTool, checkSecurityPolicyTool],
    SECURITY_SYSTEM,
    'security',
  );
}

export function createComplianceExpert(model: ChatOpenAI) {
  return createExpertSubGraph(model, [searchRequirementTool], COMPLIANCE_SYSTEM, 'compliance');
}

// ─── Supervisor schema & prompt ───────────────────────────────────────────────

const supervisorSchema = z.object({
  activeExperts: z
    .array(z.enum(['functional', 'performance', 'security', 'compliance']))
    .min(1)
    .max(4)
    .describe('需要参与分析的专家列表（至少 1 个，最多 4 个，functional 通常必选）'),
  reasoning: z.string().describe('选择这些专家的判断依据'),
});

const SUPERVISOR_SYSTEM = `你是需求分析主管（Supervisor）。根据需求内容决定需要哪些专家参与。

**专家职责**：
- functional（功能专家）：功能分解、用户故事、接口设计 ← 几乎所有需求必选
- performance（性能专家）：并发、响应时间、技术复杂度 ← 涉及高并发/大数据/批量处理/复杂算法时选
- security（安全专家）：认证鉴权、数据安全、权限设计 ← 涉及用户认证/权限/敏感数据/数据导出时选
- compliance（合规专家）：法规合规、个人信息保护、审计 ← 涉及个人信息/支付/医疗/金融/跨境时选

**选择原则（按优先级）**：
1. functional 默认必选
2. 含登录、权限、token、鉴权、敏感数据导出 → 加 security
3. 含大文件、高并发、批量处理、实时计算 → 加 performance
4. 含个人信息收集、支付、合同、跨境业务 → 加 compliance
5. 简单纯内部工具、无数据安全/性能要求 → 只选 functional`;

// ─── Supervisor sub-graph state ───────────────────────────────────────────────

export interface ExpertTiming {
  startMs:    number;
  durationMs: number;
  error?:     boolean;
}

export const SupervisorSubState = Annotation.Root({
  extracted:           Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  activeExperts:       Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  functionalAnalysis:  Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  performanceAnalysis: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  securityAnalysis:    Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  complianceAnalysis:  Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  analysisResult:      Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  // Per-expert tool call logs (surfaced from expert sub-graphs).
  functionalToolCalls:  Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  performanceToolCalls: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  securityToolCalls:    Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  complianceToolCalls:  Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  // Per-expert wall-clock timings (merged into a single map).
  expertTimings: Annotation<Record<string, ExpertTiming>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
});

export type SupervisorSubStateType = typeof SupervisorSubState.State;

// ─── createAnalysisSupervisorSubGraph ─────────────────────────────────────────
//
// Graph layout:
//
//   START → supervisor → ┌ functionalExpert  ┐
//                        │ performanceExpert  │ (parallel fan-out)
//                        │ securityExpert     │
//                        └ complianceExpert   ┘
//                                  ↓ (all converge)
//                             aggregator → END
//
// Each expert node self-skips (returns {}) if not in state.activeExperts.
// Error isolation: each expert node wraps its sub-graph in try-catch so a
// single expert failure does NOT block the others (9.6.1 error degradation).

export function createAnalysisSupervisorSubGraph(
  model: ChatOpenAI,
  opts?: { forceFailExperts?: string[] },
) {
  const forceFailExperts = opts?.forceFailExperts ?? [];
  // ── supervisor ───────────────────────────────────────────────────────────
  const supervisorNode = async (
    state: SupervisorSubStateType,
  ): Promise<Partial<SupervisorSubStateType>> => {
    console.log('[supervisor] 判断需要哪些专家…');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structured = (model as any).withStructuredOutput(supervisorSchema);
      const result = await structured.invoke([
        new SystemMessage(SUPERVISOR_SYSTEM),
        new HumanMessage(`需求内容：\n\n${state.extracted}`),
      ]) as z.infer<typeof supervisorSchema>;
      console.log(
        `[supervisor] 选中专家: [${result.activeExperts.join(', ')}] | 原因: ${result.reasoning}`,
      );
      return { activeExperts: result.activeExperts };
    } catch (e) {
      console.log(
        `[supervisor] 结构化输出失败 (${e instanceof Error ? e.message : e})，降级为 functional`,
      );
      return { activeExperts: ['functional'] };
    }
  };

  // ── pre-build expert sub-graphs (once per supervisor instance) ────────────
  const functionalSubGraph  = createFunctionalExpert(model);
  const performanceSubGraph = createPerformanceExpert(model);
  const securitySubGraph    = createSecurityExpert(model);
  const complianceSubGraph  = createComplianceExpert(model);

  // ── expert nodes ──────────────────────────────────────────────────────────

  const functionalExpertNode = async (
    state: SupervisorSubStateType,
  ): Promise<Partial<SupervisorSubStateType>> => {
    if (!state.activeExperts.includes('functional')) return {};
    const startMs = Date.now();
    if (forceFailExperts.includes('functional')) {
      console.log(`[functional-expert] 强制降级测试`);
      return {
        functionalAnalysis:  '[functional 专家暂不可用：[TEST] 强制降级测试] 本项分析已跳过，建议人工补充。',
        functionalToolCalls: [],
        expertTimings: { functional: { startMs, durationMs: 0, error: true } },
      };
    }
    console.log(`[functional-expert] 开始分析… t=${startMs}`);
    try {
      const result = await functionalSubGraph.invoke({
        messages:        [new HumanMessage(`请分析以下需求：\n\n${state.extracted}`)],
        expertOutput:    '',
        expertLoopCount: 0,
        toolCallLog:     [],
      });
      const durationMs = Date.now() - startMs;
      console.log(`[functional-expert] 完成 (${durationMs}ms, tools=[${result.toolCallLog.join(', ')}], ${result.expertOutput.length} 字符)`);
      return {
        functionalAnalysis:  result.expertOutput,
        functionalToolCalls: result.toolCallLog,
        expertTimings: { functional: { startMs, durationMs } },
      };
    } catch (e) {
      const durationMs = Date.now() - startMs;
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[functional-expert] 失败 (${durationMs}ms): ${errMsg}`);
      return {
        functionalAnalysis:  `[functional 专家暂不可用：${errMsg}] 本项分析已跳过，建议人工补充。`,
        functionalToolCalls: [],
        expertTimings: { functional: { startMs, durationMs, error: true } },
      };
    }
  };

  const performanceExpertNode = async (
    state: SupervisorSubStateType,
  ): Promise<Partial<SupervisorSubStateType>> => {
    if (!state.activeExperts.includes('performance')) return {};
    const startMs = Date.now();
    if (forceFailExperts.includes('performance')) {
      console.log(`[performance-expert] 强制降级测试`);
      return {
        performanceAnalysis:  '[performance 专家暂不可用：[TEST] 强制降级测试] 本项分析已跳过，建议人工补充。',
        performanceToolCalls: [],
        expertTimings: { performance: { startMs, durationMs: 0, error: true } },
      };
    }
    console.log(`[performance-expert] 开始分析… t=${startMs}`);
    try {
      const result = await performanceSubGraph.invoke({
        messages:        [new HumanMessage(`请分析以下需求的性能与架构要求：\n\n${state.extracted}`)],
        expertOutput:    '',
        expertLoopCount: 0,
        toolCallLog:     [],
      });
      const durationMs = Date.now() - startMs;
      console.log(`[performance-expert] 完成 (${durationMs}ms, tools=[${result.toolCallLog.join(', ')}], ${result.expertOutput.length} 字符)`);
      return {
        performanceAnalysis:  result.expertOutput,
        performanceToolCalls: result.toolCallLog,
        expertTimings: { performance: { startMs, durationMs } },
      };
    } catch (e) {
      const durationMs = Date.now() - startMs;
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[performance-expert] 失败 (${durationMs}ms): ${errMsg}`);
      return {
        performanceAnalysis:  `[performance 专家暂不可用：${errMsg}] 本项分析已跳过，建议人工补充。`,
        performanceToolCalls: [],
        expertTimings: { performance: { startMs, durationMs, error: true } },
      };
    }
  };

  const securityExpertNode = async (
    state: SupervisorSubStateType,
  ): Promise<Partial<SupervisorSubStateType>> => {
    if (!state.activeExperts.includes('security')) return {};
    const startMs = Date.now();
    if (forceFailExperts.includes('security')) {
      console.log(`[security-expert] 强制降级测试`);
      return {
        securityAnalysis:  '[security 专家暂不可用：[TEST] 强制降级测试] 本项分析已跳过，建议人工补充。',
        securityToolCalls: [],
        expertTimings: { security: { startMs, durationMs: 0, error: true } },
      };
    }
    console.log(`[security-expert] 开始分析… t=${startMs}`);
    try {
      const result = await securitySubGraph.invoke({
        messages:        [new HumanMessage(`请分析以下需求的安全与权限要求：\n\n${state.extracted}`)],
        expertOutput:    '',
        expertLoopCount: 0,
        toolCallLog:     [],
      });
      const durationMs = Date.now() - startMs;
      console.log(`[security-expert] 完成 (${durationMs}ms, tools=[${result.toolCallLog.join(', ')}], ${result.expertOutput.length} 字符)`);
      return {
        securityAnalysis:  result.expertOutput,
        securityToolCalls: result.toolCallLog,
        expertTimings: { security: { startMs, durationMs } },
      };
    } catch (e) {
      const durationMs = Date.now() - startMs;
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[security-expert] 失败 (${durationMs}ms): ${errMsg}`);
      return {
        securityAnalysis:  `[security 专家暂不可用：${errMsg}] 本项分析已跳过，建议人工补充。`,
        securityToolCalls: [],
        expertTimings: { security: { startMs, durationMs, error: true } },
      };
    }
  };

  const complianceExpertNode = async (
    state: SupervisorSubStateType,
  ): Promise<Partial<SupervisorSubStateType>> => {
    if (!state.activeExperts.includes('compliance')) return {};
    const startMs = Date.now();
    if (forceFailExperts.includes('compliance')) {
      console.log(`[compliance-expert] 强制降级测试`);
      return {
        complianceAnalysis:  '[compliance 专家暂不可用：[TEST] 强制降级测试] 本项分析已跳过，建议人工补充。',
        complianceToolCalls: [],
        expertTimings: { compliance: { startMs, durationMs: 0, error: true } },
      };
    }
    console.log(`[compliance-expert] 开始分析… t=${startMs}`);
    try {
      const result = await complianceSubGraph.invoke({
        messages:        [new HumanMessage(`请分析以下需求的合规与数据治理要求：\n\n${state.extracted}`)],
        expertOutput:    '',
        expertLoopCount: 0,
        toolCallLog:     [],
      });
      const durationMs = Date.now() - startMs;
      console.log(`[compliance-expert] 完成 (${durationMs}ms, tools=[${result.toolCallLog.join(', ')}], ${result.expertOutput.length} 字符)`);
      return {
        complianceAnalysis:  result.expertOutput,
        complianceToolCalls: result.toolCallLog,
        expertTimings: { compliance: { startMs, durationMs } },
      };
    } catch (e) {
      const durationMs = Date.now() - startMs;
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[compliance-expert] 失败 (${durationMs}ms): ${errMsg}`);
      return {
        complianceAnalysis:  `[compliance 专家暂不可用：${errMsg}] 本项分析已跳过，建议人工补充。`,
        complianceToolCalls: [],
        expertTimings: { compliance: { startMs, durationMs, error: true } },
      };
    }
  };

  // ── aggregator ────────────────────────────────────────────────────────────

  const aggregatorNode = async (
    state: SupervisorSubStateType,
  ): Promise<Partial<SupervisorSubStateType>> => {
    const timingsSummary = Object.entries(state.expertTimings)
      .map(([k, v]) => `${k}:${v.durationMs}ms${v.error ? '(err)' : ''}`)
      .join(', ');
    console.log(
      `[aggregator] 合并专家结论 (activeExperts=[${state.activeExperts.join(', ')}], timings={${timingsSummary}})`,
    );
    const parts: string[] = [
      `# 多专家需求分析\n\n> **参与专家**：${state.activeExperts.join(' · ')}`,
    ];

    const isDeg = (s: string) => s.includes('专家暂不可用') || s.startsWith('[ERROR]');
    const renderSection = (header: string, content: string) =>
      isDeg(content)
        ? `---\n\n## ⚠️ ${header}（降级）\n\n> ${content}`
        : `---\n\n## ${header}\n\n${content}`;

    if (state.activeExperts.includes('functional') && state.functionalAnalysis.trim()) {
      parts.push(renderSection('功能分析', state.functionalAnalysis));
    }
    if (state.activeExperts.includes('performance') && state.performanceAnalysis.trim()) {
      parts.push(renderSection('性能与架构分析', state.performanceAnalysis));
    }
    if (state.activeExperts.includes('security') && state.securityAnalysis.trim()) {
      parts.push(renderSection('安全分析', state.securityAnalysis));
    }
    if (state.activeExperts.includes('compliance') && state.complianceAnalysis.trim()) {
      parts.push(renderSection('合规分析', state.complianceAnalysis));
    }

    const analysisResult = parts.length > 1
      ? parts.join('\n\n')
      : '分析未完成（无专家结论可合并）';
    return { analysisResult };
  };

  // ── routeToExperts: always fan-out to all 4 nodes (each self-skips) ────────
  function routeToExperts(_state: SupervisorSubStateType): string[] {
    return ['functionalExpert', 'performanceExpert', 'securityExpert', 'complianceExpert'];
  }

  return new StateGraph(SupervisorSubState)
    .addNode('supervisor',        supervisorNode)
    .addNode('functionalExpert',  functionalExpertNode)
    .addNode('performanceExpert', performanceExpertNode)
    .addNode('securityExpert',    securityExpertNode)
    .addNode('complianceExpert',  complianceExpertNode)
    .addNode('aggregator',        aggregatorNode)
    .addEdge(START, 'supervisor')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addConditionalEdges('supervisor', routeToExperts as any)
    .addEdge('functionalExpert',  'aggregator')
    .addEdge('performanceExpert', 'aggregator')
    .addEdge('securityExpert',    'aggregator')
    .addEdge('complianceExpert',  'aggregator')
    .addEdge('aggregator', END)
    .compile();
}
