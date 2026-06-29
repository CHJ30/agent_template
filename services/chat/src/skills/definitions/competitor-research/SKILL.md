# Skill: competitor-research

## 用途
搜索指定产品/功能的**竞品方案**和**业界最佳实践**，为产品决策和技术选型提供外部参考依据。

## 可用工具

### search_competitors
搜索同类产品的功能特性、市场定位与优劣势对比。

**参数**：
- `query`（必填）：要搜索的产品功能或场景，如"AI 写作助手"、"RBAC 权限管理"
- `domain`（可选）：限定领域，如"SaaS"、"企业软件"、"消费者应用"

**返回**：
```json
{
  "query": "...",
  "mode": "tavily | mock",
  "results": [
    { "title": "...", "snippet": "...", "url": "..." }
  ]
}
```

### search_best_practices
搜索特定技术主题或产品领域的业界最佳实践、设计模式和避坑经验。

**参数**：
- `topic`（必填）：搜索主题，如"AI 产品设计最佳实践"
- `industry`（可选）：行业上下文，如"金融"、"医疗"、"零售"

**返回**：
```json
{
  "topic": "...",
  "mode": "tavily | mock",
  "results": [
    { "title": "...", "snippet": "...", "url": "..." }
  ]
}
```

## 使用流程
1. 调用 `search_competitors`，获取主要竞品信息
2. 调用 `search_best_practices`，补充该领域最佳实践
3. 整合结果，输出竞品分析报告，包含：主要竞品清单与核心差异、业界最佳实践摘要、产品定位建议
