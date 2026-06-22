import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

export const checkConstraintValidity = tool(
  async ({ constraint }: { constraint: string }) => {
    const keywords = ['必须', '至少', '不得', '不能', '需要', '应当'];
    const hit = keywords.find((kw) => constraint.includes(kw));
    return hit
      ? `约束"${constraint}"有效：包含明确约束关键词"${hit}"`
      : `约束"${constraint}"无效：缺少明确约束关键词（必须/至少/不得/不能）`;
  },
  {
    name: 'check_constraint_validity',
    description: '检查从需求文本中提取的约束条件是否含有明确约束关键词',
    schema: z.object({
      constraint: z.string().describe('待校验的约束条件原文'),
    }),
  },
);

export const lookupEntityDefinition = tool(
  async ({ entity }: { entity: string }) => {
    const dict: Record<string, string> = {
      手机号: '用户手机号码，11位数字，用于身份验证与通知',
      密码: '用户登录凭证，需满足最低位数与复杂度要求',
      用户: '使用系统的自然人账户主体',
      注册: '用户创建账户的操作流程',
    };
    return dict[entity] ?? `实体"${entity}"暂无预定义，请结合业务上下文理解`;
  },
  {
    name: 'lookup_entity_definition',
    description: '查询需求文本中实体名词的标准业务定义',
    schema: z.object({
      entity: z.string().describe('待查询的实体名词'),
    }),
  },
);

export const basicTools: StructuredToolInterface[] = [checkConstraintValidity, lookupEntityDefinition];
