# Functional Expert 接入示例

> 教学接入示例，不表示当前主图已经集成。不要直接覆盖 `experts.ts`。

```ts
function buildFunctionalExpertTools(deps) {
  return [
    searchRequirementTool,
    checkConflictsTool,
    createRagTool({
      ragAsk: deps.ragAsk,
      getBudgetUsedPercent: deps.getBudgetUsedPercent,
      resolveBudgetAction: deps.resolveBudgetAction,
      agentName: 'functional_expert',
    }),
  ];
}
```

RAG Tool 应在独立页面完成 Tool 误调用率、Citation、无答案拒答和 Prompt Injection 测试后，再接入 Functional Expert。
