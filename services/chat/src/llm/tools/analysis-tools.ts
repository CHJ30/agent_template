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

export const analysisTools = [searchRequirementTool, checkConflictsTool];
