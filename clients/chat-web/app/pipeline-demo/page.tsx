"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppHeader } from "../../components/AppHeader";
import { useDemoUser } from "../../components/useDemoUser";

interface PipelineStep {
  id: string;
  description: string;
  done: boolean;
}

interface StepResult {
  stepId: string;
  description: string;
  output: string;
  activeExperts: string[];
  durationMs: number;
  error?: string;
}

interface PipelineState {
  plan: PipelineStep[];
  stepResults: Record<string, StepResult>;
  reflections: string[];
  retryCount: number;
  finalReport: string;
  evalPass: boolean;
  evalScore: number;
  evalFeedback: string;
}

type PipelineEvent =
  | { type: "pipeline_start"; threadId: string }
  | { type: "plan_created"; plan: PipelineStep[]; retryCount: number }
  | { type: "step_completed"; result: StepResult; completed: number; total: number; retryCount: number }
  | { type: "synthesis_completed"; report: string; retryCount: number }
  | { type: "evaluation_completed"; pass: boolean; score: number; feedback: string; retryCount: number }
  | { type: "reflection_completed"; reflection: string; plan: PipelineStep[]; retryCount: number }
  | { type: "pipeline_complete"; state: PipelineState }
  | { type: "error"; error: string };

interface EvaluationRecord {
  pass: boolean;
  score: number;
  feedback: string;
  retryCount: number;
}

interface TestTicket {
  id: string;
  title: string;
  dependsOn: string[];
}

interface PipelineTestCase {
  id: string;
  title: string;
  description: string;
  tickets: TestTicket[];
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const EXPERT_LABELS: Record<string, string> = {
  functional: "功能",
  performance: "性能",
  security: "安全",
  compliance: "合规",
};

async function* readPipelineStream(caseId: string): AsyncGenerator<PipelineEvent> {
  const response = await fetch(`${BASE}/api/pipeline-demo/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId }),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        yield JSON.parse(line.slice(5).trim()) as PipelineEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${ms} 毫秒`;
}

function StatusDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
        done
          ? "bg-emerald-100 text-emerald-700"
          : active
            ? "animate-pulse bg-blue-100 text-blue-700"
            : "bg-gray-100 text-gray-400",
      ].join(" ")}
    >
      {done ? "✓" : active ? "●" : "○"}
    </span>
  );
}

export default function PipelineDemoPage() {
  const [userKey, setUserKey] = useDemoUser();
  const [testCases, setTestCases] = useState<PipelineTestCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [loadingCases, setLoadingCases] = useState(true);
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [plan, setPlan] = useState<PipelineStep[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [currentRound, setCurrentRound] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [draftReport, setDraftReport] = useState("");
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [reflections, setReflections] = useState<string[]>([]);
  const [finalState, setFinalState] = useState<PipelineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resultList = useMemo(
    () => Object.entries(results)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, result]) => ({ key, result })),
    [results],
  );
  const selectedCase = useMemo(
    () => testCases.find((item) => item.id === selectedCaseId) ?? testCases[0] ?? null,
    [selectedCaseId, testCases],
  );

  useEffect(() => {
    let cancelled = false;
    void fetch(`${BASE}/api/pipeline-demo/cases`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PipelineTestCase[]>;
      })
      .then((items) => {
        if (cancelled) return;
        setTestCases(items);
        setSelectedCaseId(items[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingCases(false);
      });
    return () => { cancelled = true; };
  }, []);

  function resetRun() {
    setThreadId("");
    setPlan([]);
    setResults({});
    setCurrentRound(0);
    setPhase("idle");
    setDraftReport("");
    setEvaluations([]);
    setReflections([]);
    setFinalState(null);
    setError(null);
  }

  async function runPipeline() {
    if (!selectedCase || running) return;
    resetRun();
    setRunning(true);
    setPhase("planner");

    try {
      for await (const event of readPipelineStream(selectedCase.id)) {
        switch (event.type) {
          case "pipeline_start":
            setThreadId(event.threadId);
            setPhase("planner");
            break;
          case "plan_created":
            setPlan(event.plan);
            setCurrentRound(event.retryCount);
            setPhase("executor");
            break;
          case "step_completed":
            setCurrentRound(event.retryCount);
            setResults((previous) => ({
              ...previous,
              [`r${event.retryCount}:${event.result.stepId}`]: event.result,
            }));
            setPlan((previous) => previous.map((step, index) =>
              index < event.completed ? { ...step, done: true } : step,
            ));
            setPhase(event.completed >= event.total ? "synthesizer" : "executor");
            break;
          case "synthesis_completed":
            setDraftReport(event.report);
            setPhase("evaluator");
            break;
          case "evaluation_completed":
            setEvaluations((previous) => [...previous, event]);
            setPhase(event.pass ? "complete" : event.retryCount >= 1 ? "complete" : "reflector");
            break;
          case "reflection_completed":
            setReflections((previous) => [...previous, event.reflection]);
            setPlan(event.plan);
            setCurrentRound(event.retryCount);
            setPhase("executor");
            break;
          case "pipeline_complete":
            setFinalState(event.state);
            setDraftReport(event.state.finalReport);
            setPlan(event.state.plan);
            setResults(event.state.stepResults);
            setReflections(event.state.reflections);
            setCurrentRound(event.state.retryCount);
            setPhase("complete");
            break;
          case "error":
            setError(event.error);
            setPhase("error");
            break;
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    } finally {
      setRunning(false);
    }
  }

  const phases = [
    { key: "planner", label: "规划任务" },
    { key: "executor", label: "执行子任务" },
    { key: "synthesizer", label: "合并报告" },
    { key: "evaluator", label: "质量评估" },
    { key: "reflector", label: "反思计划" },
  ];
  const phaseIndex = phases.findIndex((item) => item.key === phase);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <AppHeader
        active="pipeline"
        userKey={userKey}
        onUserKeyChange={setUserKey}
      />

      <main className="mx-auto grid max-w-7xl gap-5 p-5 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">数据库测试案例</h2>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-bold tracking-wide text-rose-700">TEST</span>
            </div>
            {loadingCases ? (
              <p className="mt-4 text-xs text-slate-400">正在读取测试案例…</p>
            ) : selectedCase ? (
              <div className="mt-3">
                <p className="text-sm font-semibold text-slate-800">{selectedCase.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{selectedCase.description}</p>
                <div className="mt-3 space-y-2">
                  {selectedCase.tickets.map((ticket) => (
                    <div key={ticket.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-semibold text-blue-700">{ticket.id}</span>
                        <span className="text-xs font-medium text-slate-700">{ticket.title}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {ticket.dependsOn.length ? `依赖：${ticket.dependsOn.join("、")}` : "基础行情工单"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs text-red-600">数据库中没有可用测试案例</p>
            )}
            <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => void runPipeline()}
                disabled={running || !selectedCase}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {running ? "测试执行中…" : "运行测试"}
              </button>
              <span className="max-w-32 text-[10px] leading-4 text-slate-400">案例：5 个关联金融实时行情工单</span>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">外层工作流</h2>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                第 {currentRound + 1} 轮
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {phases.map((item, index) => {
                const active = phase === item.key;
                const done = phase === "complete" || (phaseIndex >= 0 && index < phaseIndex);
                return (
                  <div key={item.key} className="flex items-center gap-3">
                    <StatusDot active={active} done={done} />
                    <span className={active ? "text-sm font-medium text-blue-700" : "text-sm text-slate-600"}>{item.label}</span>
                    {item.key === "executor" && plan.length > 0 && (
                      <span className="ml-auto text-xs text-slate-400">
                        {plan.filter((step) => step.done).length}/{plan.length}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {threadId && <p className="mt-4 break-all border-t border-slate-100 pt-3 font-mono text-[10px] text-slate-400">{threadId}</p>}
          </section>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
          )}
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">执行计划</h2>
              <span className="text-xs text-slate-400">{plan.length} 个步骤</span>
            </div>
            {plan.length === 0 ? (
              <p className="mt-6 text-center text-sm text-slate-400">等待 Planner 生成计划</p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {plan.map((step, index) => (
                  <article key={step.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-white px-2 py-1 font-mono text-[10px] text-slate-500">{step.id}</span>
                      <span className={step.done ? "text-xs text-emerald-600" : "text-xs text-slate-400"}>{step.done ? "已完成" : `步骤 ${index + 1}`}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-700">{step.description}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          {resultList.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold">子任务与 Supervisor 专家结果</h2>
              <div className="mt-4 space-y-3">
                {resultList.map(({ key, result }) => (
                  <details key={key} className="group rounded-xl border border-slate-200 bg-slate-50 p-3" open={result.error !== undefined}>
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-400">{key}</span>
                        <span className="text-sm font-medium text-slate-800">{result.stepId}</span>
                        <span className="text-xs text-slate-400">{formatDuration(result.durationMs)}</span>
                        <div className="ml-auto flex gap-1">
                          {result.activeExperts.map((expert) => (
                            <span key={expert} className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                              {EXPERT_LABELS[expert] ?? expert}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{result.description}</p>
                    </summary>
                    <div className="prose prose-sm mt-4 max-w-none border-t border-slate-200 pt-4 text-slate-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.output}</ReactMarkdown>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {(evaluations.length > 0 || reflections.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold">质量评估</h2>
                <div className="mt-3 space-y-3">
                  {evaluations.map((evaluation, index) => (
                    <div key={`${evaluation.retryCount}-${index}`} className={evaluation.pass ? "rounded-xl border border-emerald-200 bg-emerald-50 p-3" : "rounded-xl border border-amber-200 bg-amber-50 p-3"}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">第 {evaluation.retryCount + 1} 轮</span>
                        <span className="text-lg font-bold">{evaluation.score.toFixed(1)}<span className="text-xs font-normal">/10</span></span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{evaluation.feedback}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold">Reflexion 记录</h2>
                {reflections.length === 0 ? (
                  <p className="mt-5 text-center text-xs text-slate-400">报告通过时不会触发反思</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {reflections.map((reflection, index) => (
                      <div key={index} className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900">
                        <span className="font-semibold">第 {index + 1} 次反思</span>
                        <p className="mt-1 whitespace-pre-wrap">{reflection}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {(draftReport || finalState) && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <h2 className="text-base font-semibold">联合分析报告</h2>
                {finalState && (
                  <span className={finalState.evalPass ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700"}>
                    {finalState.evalPass ? "评估通过" : `达到重试上限 · ${finalState.evalScore.toFixed(1)} 分`}
                  </span>
                )}
              </div>
              <article className="prose prose-slate mt-5 max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalState?.finalReport ?? draftReport}</ReactMarkdown>
              </article>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
