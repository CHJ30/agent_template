import { ChatOpenAI } from '@langchain/openai';
import { createAnalysisSupervisorSubGraph } from './experts.js';
import type { ExpertTiming } from './experts.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SupervisorTestCase {
  id: number;
  description: string;
  input: string;
  /** Experts that MUST appear in activeExperts. */
  expectedExperts: string[];
  /** Experts that must NOT appear (strict dispatch tests). */
  forbiddenExperts?: string[];
  /** Tool names that must appear in the expert's toolCallLog. */
  requiredTools?: Partial<Record<'functional' | 'performance' | 'security' | 'compliance', string[]>>;
  /** Check parallel timing (only meaningful for 2+ experts). */
  checkParallel?: boolean;
}

export interface SupervisorValidation {
  key:         string;
  description: string;
  pass:        boolean;
}

export interface SupervisorTestResult {
  caseId:      number;
  description: string;
  input:       string;
  // ── supervisor ──
  activeExperts: string[];
  // ── per-expert output ──
  functionalAnalysis:  string;
  performanceAnalysis: string;
  securityAnalysis:    string;
  complianceAnalysis:  string;
  // ── per-expert tool call logs ──
  functionalToolCalls:  string[];
  performanceToolCalls: string[];
  securityToolCalls:    string[];
  complianceToolCalls:  string[];
  // ── timing ──
  expertTimings:    Record<string, ExpertTiming>;
  /** Sum of all active expert durations (sequential estimate). */
  sumExpertMs:      number;
  /** Wall-clock time for the full supervisor graph. */
  durationMs:       number;
  // ── aggregated result ──
  analysisResult: string;
  // ── test outcome ──
  pass:        boolean;
  validations: SupervisorValidation[];
  error?:      string;
}

// ─── Test cases ────────────────────────────────────────────────────────────────

export const SUPERVISOR_TEST_CASES: SupervisorTestCase[] = [
  // ── 1. Dispatch correctness: simple requirement → functional only ─────────
  {
    id: 1,
    description: '简单需求（文案修改）→ 仅调用功能专家',
    input: '将首页 Banner 文案从"限时优惠"修改为"新品上市"，同步更新活动落地页标题',
    expectedExperts: ['functional'],
    forbiddenExperts: ['performance', 'security', 'compliance'],
    requiredTools: {},
  },
  // ── 2. Dispatch correctness: batch import → functional + performance ──────
  {
    id: 2,
    description: '批量导入场景 → 功能 + 性能专家，验证并行执行',
    input:
      '开发商品 Excel 批量导入功能：支持单次上传 50 万条记录，' +
      '后台异步处理，实时进度展示，完成后生成导入报告（成功/失败明细）',
    expectedExperts: ['functional', 'performance'],
    requiredTools: {
      performance: ['load_perf_baseline'],
    },
    checkParallel: true,
  },
  // ── 3. Dispatch correctness: sensitive data export → functional + perf + security ──
  {
    id: 3,
    description: '敏感数据导出 → 功能 + 性能 + 安全专家，验证安全工具调用',
    input:
      '开发用户数据导出功能：支持按条件筛选后导出含手机号、身份证号、' +
      '交易记录的 Excel 文件，单次最多 100 万条，导出需审批',
    expectedExperts: ['functional', 'performance', 'security'],
    requiredTools: {
      performance: ['load_perf_baseline'],
      security:    ['check_security_policy'],
    },
    checkParallel: true,
  },
  // ── 4. Dispatch correctness: cross-border finance → all 4 experts ─────────
  {
    id: 4,
    description: '跨境金融场景 → 全部四个专家，验证完整并行与聚合',
    input:
      '建设跨境支付清算平台：支持多币种实时汇兑、外汇合规报备、' +
      '大额交易反洗钱校验（AML）、用户实名 KYC 认证，日均处理量超过 500 万笔',
    expectedExperts: ['functional', 'performance', 'security', 'compliance'],
    requiredTools: {
      performance: ['load_perf_baseline'],
      security:    ['check_security_policy'],
    },
    checkParallel: true,
  },
  // ── 5. Error handling: vague requirement → must not produce empty experts ──
  {
    id: 5,
    description: '模糊需求（边界）→ 至少选一个专家，系统不崩溃',
    input: '做一个系统',
    expectedExperts: ['functional'],
    requiredTools: {},
  },
];

// ─── Required output sections per expert ─────────────────────────────────────

const REQUIRED_SECTIONS: Record<string, string[]> = {
  functional:  ['功能分解', '用户故事'],
  performance: ['性能需求', '技术复杂度'],
  security:    ['安全需求', '安全风险'],
  compliance:  ['合规', '审计'],
};

// ─── Aggregator sections injected by aggregatorNode ──────────────────────────

const AGGREGATOR_HEADERS: Record<string, string> = {
  functional:  '## 功能分析',
  performance: '## 性能与架构分析',
  security:    '## 安全分析',
  compliance:  '## 合规分析',
};

// ─── Runner ────────────────────────────────────────────────────────────────────

export async function runSupervisorTestCase(
  model: ChatOpenAI,
  caseId: number,
): Promise<SupervisorTestResult> {
  const tc = SUPERVISOR_TEST_CASES.find(c => c.id === caseId);
  if (!tc) throw new Error(`Supervisor test case ${caseId} not found`);

  const start = Date.now();
  try {
    const subGraph = createAnalysisSupervisorSubGraph(model);
    const state = await subGraph.invoke({
      extracted:            tc.input,
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
    const durationMs = Date.now() - start;

    const expertContentMap: Record<string, string> = {
      functional:  state.functionalAnalysis,
      performance: state.performanceAnalysis,
      security:    state.securityAnalysis,
      compliance:  state.complianceAnalysis,
    };
    const expertToolMap: Record<string, string[]> = {
      functional:  state.functionalToolCalls,
      performance: state.performanceToolCalls,
      security:    state.securityToolCalls,
      compliance:  state.complianceToolCalls,
    };

    // Sum of individual expert durations (sequential estimate for parallel check).
    const sumExpertMs = Object.values(state.expertTimings)
      .filter(t => !t.error)
      .reduce((acc, t) => acc + t.durationMs, 0);

    // ── Build validations ──────────────────────────────────────────────────
    const validations: SupervisorValidation[] = [];

    // 1. Supervisor produced non-empty expert list.
    validations.push({
      key:         'supervisor_ok',
      description: `Supervisor 选中专家: [${state.activeExperts.join(', ')}]`,
      pass:        state.activeExperts.length > 0,
    });

    // 2. All expected experts are selected.
    for (const expert of tc.expectedExperts) {
      validations.push({
        key:         `dispatch_${expert}`,
        description: `选中了预期专家 ${expert}`,
        pass:        state.activeExperts.includes(expert),
      });
    }

    // 3. Strict dispatch: forbidden experts must NOT be selected (case 1 only).
    for (const expert of tc.forbiddenExperts ?? []) {
      validations.push({
        key:         `no_${expert}`,
        description: `未多余选中 ${expert} 专家`,
        pass:        !state.activeExperts.includes(expert),
      });
    }

    // 4. Per-expert output non-empty and contains required sections.
    for (const expert of state.activeExperts) {
      const content = expertContentMap[expert] ?? '';
      const isError = content.startsWith('[ERROR]');
      validations.push({
        key:         `output_${expert}`,
        description: `${expert} 专家输出非空（>50 字符）`,
        pass:        !isError && content.trim().length > 50,
      });
      const sections = REQUIRED_SECTIONS[expert] ?? [];
      for (const section of sections) {
        validations.push({
          key:         `section_${expert}_${section}`,
          description: `${expert} 输出包含"${section}"章节`,
          pass:        !isError && content.includes(section),
        });
      }
    }

    // 5. Aggregated report: non-empty, contains each active expert's section header.
    validations.push({
      key:         'has_result',
      description: '聚合报告非空（>100 字符）',
      pass:        state.analysisResult.trim().length > 100,
    });
    for (const expert of state.activeExperts) {
      const header = AGGREGATOR_HEADERS[expert];
      validations.push({
        key:         `aggregated_${expert}`,
        description: `聚合报告包含 "${header}"`,
        pass:        state.analysisResult.includes(header),
      });
    }

    // 6. Tool call verification: required tools must appear in toolCallLog.
    for (const [expert, requiredToolList] of Object.entries(tc.requiredTools ?? {})) {
      if (!state.activeExperts.includes(expert)) continue;
      const actualCalls = expertToolMap[expert] ?? [];
      for (const toolName of requiredToolList) {
        validations.push({
          key:         `tool_${expert}_${toolName}`,
          description: `${expert} 专家调用了 ${toolName}`,
          pass:        actualCalls.includes(toolName),
        });
      }
    }

    // 7. Tool call count within maxSteps limit (≤6 per expert).
    for (const expert of state.activeExperts) {
      const count = (expertToolMap[expert] ?? []).length;
      validations.push({
        key:         `toolcount_${expert}`,
        description: `${expert} 工具调用次数 ${count} ≤ 6`,
        pass:        count <= 6,
      });
    }

    // 8. Parallel execution: total wall-clock < 70% of sequential sum (for 2+ experts).
    if (tc.checkParallel && state.activeExperts.length >= 2 && sumExpertMs > 0) {
      const threshold = sumExpertMs * 0.7;
      validations.push({
        key:         'parallel_exec',
        description: `并行执行: 总耗时 ${durationMs}ms < 顺序估算 ${Math.round(threshold)}ms（${sumExpertMs}ms × 70%）`,
        pass:        durationMs < threshold,
      });
      // Also verify experts started within 10s of each other (concurrent launch).
      const startTimes = state.activeExperts
        .map(e => state.expertTimings[e]?.startMs)
        .filter((t): t is number => t !== undefined);
      if (startTimes.length >= 2) {
        const startSpreadMs = Math.max(...startTimes) - Math.min(...startTimes);
        validations.push({
          key:         'concurrent_launch',
          description: `专家并发启动: 最大启动时差 ${startSpreadMs}ms < 10000ms`,
          pass:        startSpreadMs < 10_000,
        });
      }
    }

    return {
      caseId:               tc.id,
      description:          tc.description,
      input:                tc.input,
      activeExperts:        state.activeExperts,
      functionalAnalysis:   state.functionalAnalysis,
      performanceAnalysis:  state.performanceAnalysis,
      securityAnalysis:     state.securityAnalysis,
      complianceAnalysis:   state.complianceAnalysis,
      functionalToolCalls:  state.functionalToolCalls,
      performanceToolCalls: state.performanceToolCalls,
      securityToolCalls:    state.securityToolCalls,
      complianceToolCalls:  state.complianceToolCalls,
      expertTimings:        state.expertTimings,
      sumExpertMs,
      durationMs,
      analysisResult:       state.analysisResult,
      pass:                 validations.every(v => v.pass),
      validations,
    };
  } catch (e) {
    return {
      caseId:               tc.id,
      description:          tc.description,
      input:                tc.input,
      activeExperts:        [],
      functionalAnalysis:   '',
      performanceAnalysis:  '',
      securityAnalysis:     '',
      complianceAnalysis:   '',
      functionalToolCalls:  [],
      performanceToolCalls: [],
      securityToolCalls:    [],
      complianceToolCalls:  [],
      expertTimings:        {},
      sumExpertMs:          0,
      durationMs:           Date.now() - start,
      analysisResult:       '',
      pass:                 false,
      validations:          [],
      error:                e instanceof Error ? e.message : String(e),
    };
  }
}
