#!/usr/bin/env python3
"""
search_best_practices.py
输入 (stdin): { "topic": "...", "industry": "..." (optional) }
输出 (stdout): { "topic", "mode", "results": [{ "title", "snippet", "url" }] }
"""
import json
import sys
import re
import os

MOCK = {
    "ai_product": [
        {
            "title": "AI 写作产品设计最佳实践：提示词工程与用户体验",
            "snippet": "优秀的 AI 写作产品需提供「意图引导」（减少空白焦虑）、「渐进输出」（streaming 显示）、「可解释结果」（高亮 AI 修改部分）三个体验核心。避免无限生成框，要引导用户明确诉求。",
            "url": "https://example.dev/ai-writing-ux-best-practices",
        },
        {
            "title": "AI 功能产品化：从原型到生产的六个陷阱",
            "snippet": "① 幻觉处理（RAG + 来源引用）② 延迟感知优化（streaming + 骨架屏）③ 内容安全过滤 ④ 成本控制（缓存 + 模型降级）⑤ 降级方案（API 熔断后的兜底）⑥ 用户反馈收集——六个维度缺一不可。",
            "url": "https://example.dev/ai-product-pitfalls",
        },
        {
            "title": "2024 AI 写作工具用户调研报告",
            "snippet": "72% 用户最看重输出质量，58% 关注响应速度，45% 重视多语言支持。流失原因前三：价格过高（61%）、中文效果差（48%）、功能不足（35%）。付费意愿与实际输出质量强相关。",
            "url": "https://example.dev/ai-writing-user-research-2024",
        },
        {
            "title": "AI 写作助手的差异化策略：垂直场景 vs 通用工具",
            "snippet": "通用写作工具竞争白热化，垂直场景（法律文书/营销文案/代码注释）存在差异化空间。垂直工具的 NPS 平均比通用工具高 15 分，但 TAM 更小，需精准定位目标用户群。",
            "url": "https://example.dev/ai-writing-differentiation",
        },
    ],
    "realtime": [
        {
            "title": "实时消息推送最佳实践：可靠性与扩展性设计",
            "snippet": "生产级实时系统需考虑消息可靠性（ACK+重试）、水平扩展（Redis Pub/Sub）、断线重连（指数退避 1s→2s→4s）、消息幂等去重。单机 WS 服务需引入 Redis 解决多节点路由问题。",
            "url": "https://example.dev/realtime-best-practices",
        },
    ],
    "permission": [
        {
            "title": "RBAC 权限设计最佳实践：三层权限体系",
            "snippet": "功能权限（菜单/按钮）+ 数据权限（行过滤）+ 字段权限（列脱敏）三层独立设计；遵循最小权限原则；权限变更写审计日志（操作人/时间/变更内容）。角色继承层级不超过 3 层。",
            "url": "https://example.dev/rbac-three-layer-best-practices",
        },
    ],
    "default": [
        {
            "title": "软件产品最佳实践：从用户故事到可发布功能",
            "snippet": "用户故事驱动开发 → 验收标准量化完成 → 迭代增量交付 → 数据驱动迭代。避免「完美主义陷阱」，优先交付 MVP 并收集真实用户反馈，再决定是否深入投入。",
            "url": "https://example.dev/software-product-best-practices",
        },
        {
            "title": "技术选型决策框架：如何客观评估候选方案",
            "snippet": "从成熟度、社区活跃度、学习曲线、性能基准、License 五个维度打分；PoC 验证关键风险点；优先选择团队已有经验的技术栈以降低摩擦成本。",
            "url": "https://example.dev/tech-selection-framework",
        },
    ],
}


def select_mock(topic: str, industry: str = None) -> list:
    t = (topic or "").lower()
    if re.search(r"ai.{0,5}写作|写作.{0,5}ai|ai.{0,5}助手|ai.{0,5}产品|ai.{0,5}工具", t):
        return MOCK["ai_product"]
    if re.search(r"实时|websocket|推送|socket|消息", t):
        return MOCK["realtime"]
    if re.search(r"权限|rbac|acl|鉴权", t):
        return MOCK["permission"]
    return MOCK["default"]


def tavily_search(query: str, max_results: int = 5) -> list:
    import urllib.request
    api_key = os.environ["TAVILY_API_KEY"]
    body = json.dumps({
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "max_results": max_results,
        "include_answer": False,
    }).encode()
    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return [
        {"title": r["title"], "snippet": r["content"][:280], "url": r["url"]}
        for r in data.get("results", [])
    ]


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    topic = payload.get("topic", "")
    industry = payload.get("industry")

    full_query = f"{topic} best practices {industry} industry patterns" if industry else \
                 f"{topic} best practices design patterns architecture"

    mode = "mock"
    results = []

    if os.environ.get("TAVILY_API_KEY"):
        try:
            results = tavily_search(full_query)
            mode = "tavily"
        except Exception as e:
            sys.stderr.write(f"[search_best_practices] Tavily error, using mock: {e}\n")
            results = select_mock(topic, industry)
    else:
        results = select_mock(topic, industry)

    output = {"topic": topic, "mode": mode, "results": results[:5]}
    print(json.dumps(output, ensure_ascii=False))
