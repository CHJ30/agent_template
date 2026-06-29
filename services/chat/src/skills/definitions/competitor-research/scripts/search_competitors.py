#!/usr/bin/env python3
"""
search_competitors.py
输入 (stdin): { "query": "...", "domain": "..." (optional) }
输出 (stdout): { "query", "mode", "results": [{ "title", "snippet", "url" }] }

有 TAVILY_API_KEY 时调用真实搜索；否则按关键词返回预置 Mock 数据。
"""
import json
import sys
import re
import os

# ─── Mock 数据库 ──────────────────────────────────────────────────────────────

MOCK = {
    "ai_writing": [
        {
            "title": "Jasper AI vs Copy.ai：AI 写作工具功能对比 2024",
            "snippet": "Jasper 长文创作能力强，支持 50+ 模板；Copy.ai 免费版慷慨，适合短文案快速生成。两者均支持多语言，但中文效果参差不齐。Jasper 月费 $49 起，Copy.ai 免费版有每月额度限制。",
            "url": "https://example.dev/jasper-vs-copyai-2024",
        },
        {
            "title": "Notion AI 写作功能深度评测",
            "snippet": "Notion AI 无缝嵌入文档工作流，支持续写/改写/总结；核心缺点是无法独立使用，强依附于 Notion 生态。月费 $10 叠加在 Notion 订阅上，对重度 Notion 用户性价比高。",
            "url": "https://example.dev/notion-ai-review",
        },
        {
            "title": "国内 AI 写作工具横评：秘塔 AI vs 讯飞星火 vs 文心一言",
            "snippet": "秘塔 AI 长文写作流程最完整，支持大纲→草稿→润色全流程；讯飞星火在专业领域（法律/医疗）表现突出；文心一言中文理解最自然，免费额度最充足。",
            "url": "https://example.dev/cn-ai-writing-comparison",
        },
        {
            "title": "AI 写作助手市场分析：2024 年竞争格局",
            "snippet": "全球 AI 写作市场 2024 年规模约 18 亿美元，Grammarly/Jasper/Writer 占据 B 端；个人用户向 ChatGPT 聚集；垂直细分工具面临整合压力，差异化是生存关键。",
            "url": "https://example.dev/ai-writing-market-2024",
        },
        {
            "title": "Grammarly vs ProWritingAid：语法检查+AI写作功能对比",
            "snippet": "Grammarly 界面更直观，浏览器插件生态完善；ProWritingAid 深度风格分析更强，适合专业作家。两者 AI 写作建议质量相近，差异在于工作流集成深度。",
            "url": "https://example.dev/grammarly-vs-prowritingaid",
        },
    ],
    "batch_import": [
        {
            "title": "Fivetran vs Airbyte：数据导入平台竞品分析",
            "snippet": "Fivetran 主打 SaaS 即用型（150+ 连接器），零代码运维；Airbyte 开源自托管，社区连接器 300+，适合有工程资源的团队。Fivetran 成本较高，Airbyte Cloud 提供中间选项。",
            "url": "https://example.dev/fivetran-vs-airbyte",
        },
        {
            "title": "Stitch vs Segment：小团队数据导入工具对比",
            "snippet": "Stitch 专注 ETL，轻量易用，适合小团队；Segment 是 CDP，兼顾数据收集与分发。如果只需要导入数据库，Stitch 更简单；若需用户行为分析，Segment 更合适。",
            "url": "https://example.dev/stitch-vs-segment",
        },
    ],
    "default": [
        {
            "title": "软件竞品分析方法论：特性矩阵与用户评价结合",
            "snippet": "有效竞品分析需结合特性矩阵（功能对比）、用户评价（G2/Capterra）、定价策略和增长数据（SimilarWeb）四个维度，避免仅凭官网信息产生幻觉。",
            "url": "https://example.dev/competitive-analysis-methodology",
        },
        {
            "title": "如何进行 SaaS 竞品调研：六步框架",
            "snippet": "① 确定分析维度 → ② 识别直接/间接竞品 → ③ 功能矩阵对比 → ④ 用户痛点分析（Reddit/App Store）→ ⑤ 定价策略研究 → ⑥ 差异化定位建议。",
            "url": "https://example.dev/saas-competitor-research-framework",
        },
    ],
}


def select_mock(query: str, domain: str = None) -> list:
    q = (query or "").lower()
    if re.search(r"ai.{0,5}写作|写作.{0,5}ai|writing.{0,5}assist|ai.{0,5}writ", q):
        return MOCK["ai_writing"]
    if re.search(r"批量|导入|import|etl", q):
        return MOCK["batch_import"]
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
    query = payload.get("query", "")
    domain = payload.get("domain")

    full_query = f"{query} {domain} competitors alternatives comparison" if domain else \
                 f"{query} competitors alternative products comparison"

    mode = "mock"
    results = []

    if os.environ.get("TAVILY_API_KEY"):
        try:
            results = tavily_search(full_query)
            mode = "tavily"
        except Exception as e:
            sys.stderr.write(f"[search_competitors] Tavily error, using mock: {e}\n")
            results = select_mock(query, domain)
    else:
        results = select_mock(query, domain)

    output = {"query": query, "mode": mode, "results": results[:5]}
    print(json.dumps(output, ensure_ascii=False))
