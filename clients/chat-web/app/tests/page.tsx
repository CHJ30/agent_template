"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const TEST_PAGES = [
  {
    id: "ui-component",
    label: "UIcomponent",
    href: "/ui-component-test",
    description: "UI protocol version, unknown component fallback, and SSE streaming protocol tests.",
  },
  {
    id: "graph",
    label: "Graph Test",
    href: "/graph-test",
    description: "Requirement analysis graph execution test.",
  },
  {
    id: "analysis",
    label: "ReAct Test",
    href: "/analysis-test",
    description: "ReAct analysis flow test.",
  },
  {
    id: "supervisor",
    label: "Supervisor Test",
    href: "/supervisor-test",
    description: "Supervisor routing and expert orchestration test.",
  },
  {
    id: "production",
    label: "Production Hardening",
    href: "/production-test",
    description: "Production safety and fallback behavior test.",
  },
  {
    id: "mcp",
    label: "MCP Inspector",
    href: "/mcp-inspector",
    description: "MCP proxy and tool inspection page.",
  },
  {
    id: "web-search",
    label: "Web Search",
    href: "/web-search-test",
    description: "Web search tool integration test.",
  },
  {
    id: "skills",
    label: "Skills Demo",
    href: "/skills-demo",
    description: "Skill loading and tool demo page.",
  },
  {
    id: "memory",
    label: "Memory Test",
    href: "/memory-test",
    description: "PostgreSQL-backed conversation memory: session list + multi-turn recall test.",
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
          <span className="text-sm font-semibold text-gray-700">Tests</span>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-50"
        >
          Back
        </Link>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
        <aside className="border-r border-gray-200 bg-white p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Test pages
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
              Open route
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
