# Skill: requirement-analysis

## 用途
对软件需求文本进行**完整性检查**和**复杂度估算**，帮助产品经理与研发团队快速识别需求缺口并评估工作量。

## 可用工具

### analyze_completeness
检查需求文本是否覆盖以下 6 个关键维度：

| 维度 | 说明 | 示例关键词 |
|------|------|-----------|
| 用户角色 | 谁在使用这个功能 | 作为、管理员、用户、操作员 |
| 功能描述 | 系统需要做什么 | 支持、能够、实现、提供 |
| 验收标准 | 如何验证完成 | 验收、标准、应当、满足 |
| 优先级 | 重要程度标注 | P0/P1/P2/P3、高优、紧急 |
| 非功能需求 | 性能/安全/可用性 | 响应时间、并发、加密、SLA |
| 边界条件 | 异常与极限场景 | 超时、上限、为空、错误处理 |

**参数**：`requirementText` (string)
**返回**：`completenessScore` (0-100)、`coveredDimensions`、`missingDimensions`、`suggestion`

### estimate_complexity
通过匹配复杂因子加权打分，估算开发工作量。

| 因子 | 权重 | 关键词 |
|------|------|--------|
| 认证与权限 | 12 | 权限、RBAC、SSO、OAuth |
| 外部集成 | 12 | 集成、第三方、Webhook |
| 实时处理 | 18 | 实时、WebSocket、消息队列 |
| AI/ML | 22 | AI、模型、LLM、算法 |
| 安全合规 | 10 | 加密、审计、合规 |
| 大数据处理 | 12 | 批量、导入、ETL、报表 |
| 复杂工作流 | 12 | 审批、流程、状态机 |
| 分布式/微服务 | 18 | 微服务、分布式、多租户 |

**参数**：`requirementText` (string)，`techStack` (string, 可选)
**返回**：`size` (S/M/L/XL)、`estimatedDays`、`complexityScore`、`factors`

## 使用流程
1. 调用 `analyze_completeness`，评估需求完整性
2. 调用 `estimate_complexity`，估算开发复杂度
3. 综合两个结果，输出结构化分析报告，包含：完整性评分、缺失维度补充建议、规模估算、关键复杂因子清单
