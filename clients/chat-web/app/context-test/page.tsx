"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface TestCase { id: number; title: string; description: string; }
interface TestResult extends TestCase {
  pass: boolean;
  summaryInvocations: number;
  before: string[];
  after: string[];
}

type RunState = { status: "idle" | "running" | "pass" | "fail"; result?: TestResult; error?: string };

export default function ContextTestPage() {
  const [cases, setCases] = useState<TestCase[]>([]);
  const [states, setStates] = useState<Record<number, RunState>>({});
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    void fetch("/api/agents/context-test/cases")
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(setCases)
      .catch(error => setStates({ 0: { status: "fail", error: String(error) } }));
  }, []);

  async function runCase(testCase: TestCase): Promise<TestResult | null> {
    setStates(previous => ({ ...previous, [testCase.id]: { status: "running" } }));
    try {
      const response = await fetch("/api/agents/context-test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: testCase.id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as TestResult;
      setStates(previous => ({
        ...previous,
        [testCase.id]: { status: result.pass ? "pass" : "fail", result },
      }));
      return result;
    } catch (error) {
      setStates(previous => ({
        ...previous,
        [testCase.id]: { status: "fail", error: error instanceof Error ? error.message : String(error) },
      }));
      return null;
    }
  }

  async function runAll() {
    setRunningAll(true);
    try {
      for (const testCase of cases) await runCase(testCase);
    } finally {
      setRunningAll(false);
    }
  }

  const passCount = Object.values(states).filter(state => state.status === "pass").length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">上下文窗口与摘要压缩测试</h1>
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">TEST</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">第十章 10.5 · 使用后端真实工具函数，不调用真实 LLM</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">通过 {passCount}/{cases.length}</span>
            <Link href="/tests" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">返回测试中心</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        <section className="mb-5 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div>
            <div className="text-sm font-semibold text-blue-900">固定测试集</div>
            <p className="mt-1 text-xs text-blue-700">验证 SystemMessage 保留、滑动窗口、tool_call_id 全有或全无，以及摘要模型注入。</p>
          </div>
          <button
            onClick={() => void runAll()}
            disabled={runningAll || cases.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {runningAll ? "测试运行中…" : "运行全部测试"}
          </button>
        </section>

        {states[0]?.error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-600">加载失败：{states[0].error}</div>}

        <div className="space-y-4">
          {cases.map(testCase => {
            const state = states[testCase.id] ?? { status: "idle" as const };
            return (
              <article key={testCase.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500">CASE {testCase.id}</span>
                      <h2 className="text-sm font-semibold">{testCase.title}</h2>
                      {state.status === "running" && <span className="text-xs text-blue-600">● 运行中</span>}
                      {state.status === "pass" && <span className="text-xs font-semibold text-emerald-600">✓ 通过</span>}
                      {state.status === "fail" && <span className="text-xs font-semibold text-red-600">✕ 失败</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{testCase.description}</p>
                  </div>
                  <button
                    onClick={() => void runCase(testCase)}
                    disabled={state.status === "running" || runningAll}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >测试</button>
                </div>

                {state.error && <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-600">{state.error}</p>}
                {state.result && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <MessagePanel title={`处理前 · ${state.result.before.length} 条`} messages={state.result.before} />
                    <MessagePanel title={`处理后 · ${state.result.after.length} 条`} messages={state.result.after} />
                    {state.result.summaryInvocations > 0 && (
                      <div className="md:col-span-2 text-xs text-violet-600">摘要模型调用次数：{state.result.summaryInvocations}</div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function MessagePanel({ title, messages }: { title: string; messages: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="space-y-1.5">
        {messages.map((message, index) => (
          <div key={`${message}-${index}`} className="rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-600">{message}</div>
        ))}
        {messages.length === 0 && <div className="text-xs italic text-slate-400">无消息</div>}
      </div>
    </div>
  );
}

