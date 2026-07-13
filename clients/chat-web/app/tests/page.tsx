"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const TEST_PAGES = [
  {
    id: "ui-component",
    label: "界面组件测试",
    href: "/ui-component-test",
    description: "界面协议版本、未知组件降级处理与流式传输协议测试。",
  },
  {
    id: "graph",
    label: "流程图测试",
    href: "/graph-test",
    description: "需求分析流程图执行测试。",
  },
  {
    id: "analysis",
    label: "推理行动测试",
    href: "/analysis-test",
    description: "推理与行动分析流程测试。",
  },
  {
    id: "supervisor",
    label: "调度器测试",
    href: "/supervisor-test",
    description: "调度器路由与专家编排测试。",
  },
  {
    id: "pipeline-demo",
    label: "组合流水线演示",
    href: "/pipeline-demo",
    description: "规划执行、多专家调度与反思重试的联合分析流水线。",
  },
  {
    id: "rag-tool",
    label: "RAG as Tool",
    href: "/rag-demo",
    description: "民法典、刑法典法律知识库问答与 Citation、预算策略测试。",
  },
  {
    id: "token-usage",
    label: "Token 用量统计",
    href: "/token-usage",
    description: "按月、Graph 节点和 Agent 展示模型 Token 与成本统计。",
  },
  {
    id: "context",
    label: "上下文压缩测试",
    href: "/context-test",
    description: "消息窗口裁剪、工具调用精确配对和对话摘要压缩测试。",
  },
  {
    id: "production",
    label: "生产环境加固测试",
    href: "/production-test",
    description: "生产环境安全性与降级行为测试。",
  },
  {
    id: "mcp",
    label: "模型上下文协议检查器",
    href: "/mcp-inspector",
    description: "模型上下文协议代理与工具检查页面。",
  },
  {
    id: "web-search",
    label: "网络搜索测试",
    href: "/web-search-test",
    description: "网络搜索工具集成测试。",
  },
  {
    id: "skills",
    label: "技能演示",
    href: "/skills-demo",
    description: "技能加载与工具演示页面。",
  },
  {
    id: "memory",
    label: "记忆功能测试",
    href: "/memory-test",
    description: "基于数据库的对话记忆：会话列表与多轮回忆测试。",
  },
] as const;

export default function TestsPage() {
  const [activeId, setActiveId] = useState<(typeof TEST_PAGES)[number]["id"]>("ui-component");
  const activePage = useMemo(
    () => TEST_PAGES.find((page) => page.id === activeId) ?? TEST_PAGES[0],
    [activeId],
  );

  return (
    <div className="flex h-screen flex-col bg-gray-100">
      <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-gray-900">
            Autix
          </Link>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-700">测试中心</span>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-50"
        >
          返回
        </Link>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
        <aside className="border-r border-gray-200 bg-white p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            测试页面
          </div>
          <nav className="space-y-1">
            {TEST_PAGES.map((page) => (
              <button
                key={page.id}
                onClick={() => setActiveId(page.id)}
                className={[
                  "w-full rounded-lg px-3 py-2 text-left transition-colors",
                  activeId === page.id
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                ].join(" ")}
              >
                <div className="text-sm font-medium">{page.label}</div>
                <div className="mt-0.5 text-xs leading-5 text-gray-400">{page.description}</div>
              </button>
            ))}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-col">
          <div className="flex h-12 items-center justify-between border-b border-gray-200 bg-white px-5">
            <div>
              <div className="text-sm font-semibold text-gray-800">{activePage.label}</div>
              <div className="text-xs text-gray-400">{activePage.description}</div>
            </div>
            <Link
              href={activePage.href}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-50"
            >
              打开页面
            </Link>
          </div>

          <iframe
            key={activePage.href}
            src={activePage.href}
            title={activePage.label}
            className="h-full w-full flex-1 border-0 bg-white"
          />
        </section>
      </main>
    </div>
  );
}
