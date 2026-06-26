import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// ─── Mock requirement database ────────────────────────────────────────────────

const MOCK_DB: Record<string, object> = {
  'REQ-20240315-001': {
    reqId: 'REQ-20240315-001',
    title: '在线问卷系统',
    description:
      '开发在线问卷系统，支持多种题型（单选、多选、填空、矩阵），用户需要能够创建、编辑、发布和统计问卷结果',
    status: '待分析',
    priority: 'high',
    owner: '产品团队',
    relatedRequirements: ['REQ-20240101-005'],
    createdAt: '2024-03-15',
    tags: ['问卷', '数据收集', '统计'],
  },
  'REQ-20240415-002': {
    reqId: 'REQ-20240415-002',
    title: '用户行为分析看板',
    description: '开发用户行为分析看板，展示访问路径、停留时长、转化率等指标',
    status: '进行中',
    priority: 'medium',
    owner: '数据团队',
    relatedRequirements: [],
    createdAt: '2024-04-15',
    tags: ['数据分析', '可视化'],
  },
};

// ─── search_requirement ───────────────────────────────────────────────────────

export const searchRequirementTool = tool(
  async ({ reqId }: { reqId: string }) => {
    const key = reqId.toUpperCase();
    const data = MOCK_DB[key] ?? {
      reqId,
      title: `需求 ${reqId}`,
      description: '未找到对应需求，请确认编号是否正确。',
      status: 'unknown',
    };
    return JSON.stringify(data, null, 2);
  },
  {
    name: 'search_requirement',
    description:
      '根据需求编号（格式：REQ-YYYYMMDD-XXX）查询需求详情，包括标题、描述、状态、负责人、关联需求等。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: z.object({ reqId: z.string().describe('需求编号，格式为 REQ-YYYYMMDD-XXX') }) as any,
  },
);

// ─── check_conflicts ──────────────────────────────────────────────────────────

const CONFLICT_PATTERNS = [
  {
    re: /登录|认证|鉴权|auth|token|JWT|用户名|密码/i,
    conflict: {
      conflictType: '功能重叠',
      relatedReqId: 'REQ-20231201-042',
      existingModule: '统一认证服务 v2.3',
      description: '系统已有统一认证服务，含 JWT + refresh token、OAuth2、RBAC 权限控制',
      severity: 'medium',
      suggestion: '建议复用现有认证服务 API，仅扩展所需权限粒度，无需重新开发认证逻辑',
    },
  },
  {
    re: /文件上传|图片上传|附件|upload/i,
    conflict: {
      conflictType: '基础设施重叠',
      relatedReqId: 'REQ-20240102-003',
      existingModule: '统一文件存储服务 OSS',
      description: '系统已集成 OSS 文件存储服务，统一处理文件上传与 CDN 分发',
      severity: 'low',
      suggestion: '直接调用现有文件存储服务 SDK，配置对应 bucket 即可',
    },
  },
];

export const checkConflictsTool = tool(
  async ({ reqId, description }: { reqId?: string; description: string }) => {
    const found = CONFLICT_PATTERNS.filter(p => p.re.test(description));
    if (found.length === 0) {
      return JSON.stringify({
        hasConflict: false,
        checkedReqId: reqId ?? 'N/A',
        message: '未检测到与现有系统的明显冲突',
      });
    }
    return JSON.stringify({
      hasConflict: true,
      checkedReqId: reqId ?? 'N/A',
      conflicts: found.map(f => f.conflict),
    }, null, 2);
  },
  {
    name: 'check_conflicts',
    description:
      '检测需求是否与现有系统模块或其他需求存在冲突（功能重叠、基础设施重叠等）。',
    schema: z.object({
      reqId:       z.string().optional().describe('需求编号（可选）'),
      description: z.string().describe('需求描述文本，用于冲突关键词检测'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  },
);

// ─── load_perf_baseline ───────────────────────────────────────────────────────

const PERF_BASELINES: Record<string, object> = {
  '批量导入': { p99ResponseMs: 5000,  maxConcurrentOps: 5,      dataVolumeMB: 2048 },
  '导出':     { p99ResponseMs: 3000,  maxConcurrentOps: 50,     dataVolumeMB: 512  },
  '查询':     { p99ResponseMs: 100,   maxConcurrentOps: 5000,   dataVolumeMB: 1    },
  '支付':     { p99ResponseMs: 200,   maxConcurrentOps: 10000,  dataVolumeMB: 0.5  },
  '文件上传': { p99ResponseMs: 10000, maxConcurrentOps: 100,    dataVolumeMB: 1024 },
};

export const loadPerfBaselineTool = tool(
  async ({ scenario }: { scenario: string }) => {
    const match = Object.keys(PERF_BASELINES).find(k => scenario.includes(k));
    return JSON.stringify({
      scenario,
      baseline: match ? PERF_BASELINES[match] : { p99ResponseMs: 200, maxConcurrentOps: 1000, dataVolumeMB: 10 },
      note: match ? '基于历史数据' : '采用默认基线（未找到匹配场景）',
      measuredAt: '2024-06-01',
    });
  },
  {
    name: 'load_perf_baseline',
    description: '加载指定业务场景的历史性能基线数据（P99 响应时间、最大并发量、数据规模），用于评估当前需求的性能复杂度。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: z.object({ scenario: z.string().describe('业务场景名称，如"批量导入"、"数据导出"、"实时查询"') }) as any,
  },
);

// ─── check_perf_budget ────────────────────────────────────────────────────────

export const checkPerfBudgetTool = tool(
  async ({ concurrentOps, responseMsP99, dataVolumeMB }: {
    concurrentOps?: number;
    responseMsP99?: number;
    dataVolumeMB?: number;
  }) => {
    const budget = { maxConcurrentOps: 20_000, maxResponseMsP99: 500, maxSingleOpVolumeMB: 10_240 };
    const violations: string[] = [];
    if (concurrentOps  && concurrentOps  > budget.maxConcurrentOps)
      violations.push(`并发量 ${concurrentOps} 超出预算 ${budget.maxConcurrentOps}`);
    if (responseMsP99  && responseMsP99  > budget.maxResponseMsP99)
      violations.push(`P99 响应时间 ${responseMsP99}ms 超出预算 ${budget.maxResponseMsP99}ms`);
    if (dataVolumeMB   && dataVolumeMB   > budget.maxSingleOpVolumeMB)
      violations.push(`单次数据量 ${dataVolumeMB}MB 超出预算 ${budget.maxSingleOpVolumeMB}MB`);
    return JSON.stringify({ withinBudget: violations.length === 0, violations, budget });
  },
  {
    name: 'check_perf_budget',
    description: '检查需求的性能指标（并发量、响应时间、单次数据量）是否在系统性能预算限额内，返回是否超标及具体项。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: z.object({
      concurrentOps: z.number().optional().describe('预计最大并发操作数'),
      responseMsP99: z.number().optional().describe('要求的 P99 响应时间（毫秒）'),
      dataVolumeMB:  z.number().optional().describe('单次操作数据量（MB）'),
    }) as any,
  },
);

// ─── check_security_policy ────────────────────────────────────────────────────

export const checkSecurityPolicyTool = tool(
  async ({ reqDescription }: { reqDescription: string }) => {
    const policies: object[] = [];
    if (/密码|password|口令/i.test(reqDescription))
      policies.push({ id: 'PWD-001', rule: '密码强度 ≥8 位，含大小写+数字+特殊字符', status: 'required' });
    if (/个人信息|手机号|身份证|姓名|住址|邮箱/i.test(reqDescription))
      policies.push({ id: 'DATA-003', rule: '个人信息须加密存储，传输使用 TLS 1.2+', status: 'required' });
    if (/导出|export|下载|download/i.test(reqDescription))
      policies.push({ id: 'SEC-007', rule: '数据导出须审批流程 + 完整操作日志', status: 'required' });
    if (/支付|转账|汇款|清算|银行卡/i.test(reqDescription))
      policies.push({ id: 'FIN-002', rule: '支付操作须双因子认证 + 实时风控拦截', status: 'required' });
    if (/上传|附件|文件/i.test(reqDescription))
      policies.push({ id: 'SEC-012', rule: '文件上传须格式白名单 + 病毒扫描', status: 'recommended' });
    if (/认证|鉴权|token|jwt/i.test(reqDescription))
      policies.push({ id: 'AUTH-005', rule: 'Token 有效期 ≤24h，刷新 token 须轮换', status: 'required' });
    return JSON.stringify({ applicablePolicies: policies, policyCount: policies.length });
  },
  {
    name: 'check_security_policy',
    description: '根据需求描述检查适用的安全策略（密码策略、数据加密、导出审计、支付风控、认证 token 等）。',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: z.object({ reqDescription: z.string().describe('需求描述文本') }) as any,
  },
);

export const analysisTools = [searchRequirementTool, checkConflictsTool];
