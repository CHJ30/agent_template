#!/usr/bin/env python3
"""
analyze_completeness.py
输入 (stdin): { "requirementText": "..." }
输出 (stdout): { "completenessScore", "coveredDimensions", "missingDimensions", "suggestion" }
"""
import json
import sys

DIMENSIONS = [
    ("userRole", "用户角色",
     ["用户", "管理员", "角色", "as a", "作为", "人员", "操作者", "访客", "客户"]),
    ("functionalDescription", "功能描述",
     ["功能", "实现", "支持", "需要", "能够", "可以", "开发", "提供", "允许"]),
    ("acceptanceCriteria", "验收标准",
     ["验收", "标准", "测试", "通过", "满足", "完成条件", "期望", "应当"]),
    ("priority", "优先级",
     ["优先级", "p0", "p1", "p2", "p3", "高优", "低优", "紧急", "重要", "关键"]),
    ("nonFunctionalRequirements", "非功能需求",
     ["性能", "安全", "可用性", "响应时间", "并发", "稳定性", "吞吐", "延迟", "加密", "sla"]),
    ("boundaryConditions", "边界条件",
     ["边界", "异常", "错误处理", "上限", "下限", "最大", "最小", "为空", "超时", "限制"]),
]

DIM_HINTS = {
    "userRole":                   '补充"谁需要此功能"，例如：作为运营管理员，我希望…',
    "functionalDescription":      '明确"系统需要做什么"，例如：系统应支持用户通过…方式完成…',
    "acceptanceCriteria":         "添加可验证的完成标准，例如：当用户提交后系统应在 3 秒内返回结果",
    "priority":                   "标注优先级，例如：优先级 P1（高），本迭代必须完成",
    "nonFunctionalRequirements":  "说明性能或安全要求，例如：P99 响应时间 < 500ms，支持 1000 并发",
    "boundaryConditions":         "描述异常与边界场景，例如：列表为空时显示提示；超过 100 条时分页",
}


def analyze(text: str) -> dict:
    lower = text.lower()
    covered_labels = []
    missing_items = []   # list of (dim_id, label)

    for dim_id, label, keywords in DIMENSIONS:
        if any(kw.lower() in lower for kw in keywords):
            covered_labels.append(label)
        else:
            missing_items.append((dim_id, label))

    score = round(len(covered_labels) / len(DIMENSIONS) * 100)

    if not missing_items:
        suggestion = "需求描述完整，覆盖全部 6 个维度，可进入评审流程。"
    else:
        hints = "\n".join(
            f"• {label}：{DIM_HINTS[dim_id]}" for dim_id, label in missing_items
        )
        suggestion = f"缺少 {len(missing_items)} 个维度，建议补充：\n{hints}"

    return {
        "completenessScore": score,
        "coveredDimensions": covered_labels,
        "missingDimensions": [label for _, label in missing_items],
        "suggestion": suggestion,
    }


if __name__ == "__main__":
    data = json.load(sys.stdin)
    result = analyze(data.get("requirementText", ""))
    print(json.dumps(result, ensure_ascii=False))
