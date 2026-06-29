#!/usr/bin/env python3
"""
estimate_complexity.py
输入 (stdin): { "requirementText": "...", "techStack": "..." (optional) }
输出 (stdout): { "size", "estimatedDays", "complexityScore", "factors" }
"""
import json
import sys
import re

COMPLEXITY_FACTORS = [
    ("auth",        "认证与权限",    ["权限", "鉴权", "认证", "角色", "rbac", "sso", "token", "oauth"],   12),
    ("integration", "外部集成",     ["集成", "第三方", "外部系统", "webhook", "api对接"],                 12),
    ("realtime",    "实时处理",     ["实时", "websocket", "推送", "消息队列", "kafka", "mq", "sse"],      18),
    ("ai",          "AI / ML",     ["ai", "机器学习", "模型", "智能", "算法", "向量", "nlp", "llm"],      22),
    ("security",    "安全合规",     ["加密", "证书", "审计", "合规", "gdpr", "数据安全"],                 10),
    ("bigdata",     "大数据处理",   ["批量", "大数据", "导入", "导出", "报表", "etl"],                   12),
    ("workflow",    "复杂工作流",   ["审批", "流程", "工单", "状态机", "bpm"],                           12),
    ("distributed", "分布式/微服务", ["跨系统", "微服务", "分布式", "多租户", "k8s", "容器"],             18),
]

# (score_upper_bound, size_label, days_label)
SIZE_TABLE = [
    (20,  "S",  "1-3 天"),
    (45,  "M",  "4-8 天"),
    (70,  "L",  "9-15 天"),
    (100, "XL", "16-30 天"),
]


def estimate(text: str, tech_stack: str = None) -> dict:
    lower = text.lower()
    factors = []
    raw_score = 0

    for name, label, keywords, weight in COMPLEXITY_FACTORS:
        if any(kw in lower for kw in keywords):
            factors.append({"name": name, "label": label, "weight": weight})
            raw_score += weight

    # Tech-stack multiplier
    mult = 1.0
    if tech_stack:
        ts = tech_stack.lower()
        if re.search(r"移动|mobile|ios|android|flutter", ts):
            mult += 0.20
        layer_count = sum(
            1 for pat in [
                r"前端|frontend|react|vue|angular",
                r"后端|backend|java|node|spring|nest",
                r"移动|mobile|ios|android",
            ]
            if re.search(pat, ts)
        )
        if layer_count >= 2:
            mult += 0.15
        mult = min(1.5, mult)

    complexity_score = min(100, round(raw_score * mult))

    size, estimated_days = "S", "1-3 天"
    for thresh, sz, days in SIZE_TABLE:
        size, estimated_days = sz, days
        if complexity_score <= thresh:
            break

    return {
        "size": size,
        "estimatedDays": estimated_days,
        "complexityScore": complexity_score,
        "factors": factors,
    }


if __name__ == "__main__":
    data = json.load(sys.stdin)
    result = estimate(data.get("requirementText", ""), data.get("techStack"))
    print(json.dumps(result, ensure_ascii=False))
