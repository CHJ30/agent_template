# 10.9 预算策略接入示例

本节只提供预算决策、Token Usage 和统计页面，不修改第九章 Graph。下面是接入思路，
不表示当前主图已经完成集成。真实接入时，需要把 `tokenUsageService`、
`MONTHLY_BUDGET`、`resolveModelName` 和 `outputField` 放入现有依赖注入与 State 结构。

```ts
async function expertNodeWithBudget(state, agentName: AgentName) {
  const monthlyStats = await tokenUsageService.getMonthlyStats();
  const budgetPercent = (monthlyStats.totalCost / MONTHLY_BUDGET) * 100;

  const budgetResult = resolveBudgetAction({
    budgetUsedPercent: budgetPercent,
    agentName,
  });
  if (budgetResult.action === 'reject') {
    return { [outputField]: `[${agentName} 因预算耗尽被跳过] ${budgetResult.reason}` };
  }

  const modelResult = resolveModelForAgent({
    agentName,
    budgetStatus: { usedPercent: budgetPercent },
  });
  const modelName = resolveModelName(modelResult.selectedModelConfigId);
  const model = createChatModel({
    modelConfigId: modelResult.selectedModelConfigId,
    modelName,
  });

  const response = await withTokenUsage(
    {
      graphName: 'requirement-analysis',
      nodeName: `${agentName}`,
      agentName,
      modelName,
      overrideReason: modelResult.overrideReason ?? undefined,
    },
    tokenUsageService,
    () => model.invoke([...state.messages]),
  );

  return { messages: [response] };
}
```

`resolveBudgetAction` 只决定是否执行、降级或拒绝；`resolveModelForAgent` 只负责选择模型。
两者必须保持职责分离。当前分支尚无 10.7 的 `agent-model-set.ts`，以上模型选择函数为后续接入点。

