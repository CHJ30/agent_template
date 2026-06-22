import { z } from 'zod';

export const APP_NAME = "llm";

export const RequirementSchema = z.object({
  action: z.string().describe('唯一核心动作（动词+对象）'),
  constraints: z.array(z.string()).describe('明确约束（必须/至少/不得/不能）'),
  entities: z.array(z.string()).describe('文本中真实出现的名词'),
});

export const RequirementResultSchema = RequirementSchema;

export type RequirementResult = z.infer<typeof RequirementResultSchema>;
