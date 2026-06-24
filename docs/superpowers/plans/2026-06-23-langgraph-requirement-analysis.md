# LangGraph Requirement Analysis Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `OrchestratorService` Promise chain with a LangGraph `StateGraph` that runs the same 5 agents in the same order and returns the same result shape.

**Architecture:** Define a `RequirementAnalysisState` using `Annotation.Root` + `MessagesAnnotation.spec`. Wire five nodes (`extract → clarify → analysis → risk → summary`) with linear edges using `START`/`END` constants. `OrchestratorService` delegates entirely to the new graph and reconstructs `OrchestratorResult` from the final state.

**Tech Stack:** `@langchain/langgraph ^1.2.9`, `@langchain/core`, `@langchain/openai`, NestJS 11, TypeScript `moduleResolution: nodenext`

---

## File Map

| Action | Path | Role |
|--------|------|------|
| Create | `services/chat/src/llm/graph/requirement-analysis-graph.ts` | State definition, node closures, graph factory, `runAnalysisGraph` |
| Modify | `services/chat/src/llm/agents/orchestrator.service.ts` | Remove Promise chain; delegate to `runAnalysisGraph` |
| Modify | `services/chat/package.json` | Add `@langchain/langgraph ^1.2.9` |

No other files change. `sub-agents.ts`, prompts, controller, and module are untouched.

---

## Task 1: Install @langchain/langgraph

**Files:**
- Modify: `services/chat/package.json`

- [ ] **Step 1: Add the dependency**

In `services/chat/`, run:
```bash
cd services/chat && bun add @langchain/langgraph@^1.2.9
```

- [ ] **Step 2: Verify the package resolves**

```bash
cd services/chat && bun run typecheck 2>&1 | head -5
```

Expected: zero errors (or only pre-existing errors unrelated to langgraph). If `Cannot find module '@langchain/langgraph'` appears, the install failed — re-run step 1.

- [ ] **Step 3: Commit**

```bash
git add services/chat/package.json bun.lock
git commit -m "deps(chat): add @langchain/langgraph ^1.2.9"
```

---

## Task 2: Create `requirement-analysis-graph.ts`

**Files:**
- Create: `services/chat/src/llm/graph/requirement-analysis-graph.ts`

### What the file must do

1. Export `RequirementAnalysisState` — the Annotation definition (state schema).
2. Export `RequirementState` — the TypeScript type alias for state instances.
3. Export `createAnalysisGraph(model)` — compiles the `StateGraph` and returns a `CompiledStateGraph`.
4. Export `runAnalysisGraph(model, input, skipClarification?)` — invokes the compiled graph and returns the final state.

### Input variable mapping (must match the existing prompts)

| Node | Agent factory | Prompt input vars |
|------|--------------|-------------------|
| extract | `createExtractAgent` | `{ input }` ← `state.messages.at(-1).content` |
| clarify | `createClarifyAgent` | `{ extractedRequirement }` ← `state.extracted` |
| analysis | `createAnalysisAgent` | `{ extractedRequirement }` ← `state.extracted` |
| risk | `createRiskAgent` | `{ extractedRequirement }` ← `state.extracted` |
| summary | `createSummaryAgent` | `{ extractedRequirement, analysisResult, riskResult }` ← `state.extracted`, `state.analysis`, `state.risk` |

### skipClarification behaviour

The `clarify` node checks `state.skipClarification`. If `true`, it returns `{}` immediately (no LLM call, `clarified` stays `''`). This mirrors the old chain's `skipClarification` flag.

- [ ] **Step 1: Create the graph directory and file**

```bash
mkdir -p services/chat/src/llm/graph
```

Write `services/chat/src/llm/graph/requirement-analysis-graph.ts`:

```typescript
import { Annotation, MessagesAnnotation, StateGraph, START, END } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import {
  createExtractAgent,
  createClarifyAgent,
  createAnalysisAgent,
  createRiskAgent,
  createSummaryAgent,
} from '../agents/sub-agents.js';

// ─── State ────────────────────────────────────────────────────────────────────

export const RequirementAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,
  skipClarification: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  extracted:         Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  clarified:         Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  analysis:          Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  risk:              Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  summary:           Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
});

export type RequirementState = typeof RequirementAnalysisState.State;

// ─── Nodes ────────────────────────────────────────────────────────────────────

function buildNodes(model: ChatOpenAI) {
  const extractNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const input = String(state.messages.at(-1)?.content ?? '');
    const extracted = await createExtractAgent(model).invoke({ input });
    return { extracted };
  };

  const clarifyNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    if (state.skipClarification) return {};
    const clarified = await createClarifyAgent(model).invoke({
      extractedRequirement: state.extracted,
    });
    return { clarified };
  };

  const analysisNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const analysis = await createAnalysisAgent(model).invoke({
      extractedRequirement: state.extracted,
    });
    return { analysis };
  };

  const riskNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const risk = await createRiskAgent(model).invoke({
      extractedRequirement: state.extracted,
    });
    return { risk };
  };

  const summaryNode = async (state: RequirementState): Promise<Partial<RequirementState>> => {
    const summary = await createSummaryAgent(model).invoke({
      extractedRequirement: state.extracted,
      analysisResult: state.analysis,
      riskResult: state.risk,
    });
    return { summary };
  };

  return { extractNode, clarifyNode, analysisNode, riskNode, summaryNode };
}

// ─── Graph factory ────────────────────────────────────────────────────────────

export function createAnalysisGraph(model: ChatOpenAI) {
  const { extractNode, clarifyNode, analysisNode, riskNode, summaryNode } = buildNodes(model);

  return new StateGraph(RequirementAnalysisState)
    .addNode('extract',  extractNode)
    .addNode('clarify',  clarifyNode)
    .addNode('analysis', analysisNode)
    .addNode('risk',     riskNode)
    .addNode('summary',  summaryNode)
    .addEdge(START,      'extract')
    .addEdge('extract',  'clarify')
    .addEdge('clarify',  'analysis')
    .addEdge('analysis', 'risk')
    .addEdge('risk',     'summary')
    .addEdge('summary',  END)
    .compile();
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runAnalysisGraph(
  model: ChatOpenAI,
  input: string,
  skipClarification = false,
): Promise<RequirementState> {
  const app = createAnalysisGraph(model);
  return app.invoke({
    messages: [new HumanMessage(input)],
    skipClarification,
  });
}
```

- [ ] **Step 2: Typecheck the new file**

```bash
cd services/chat && bun run typecheck 2>&1 | grep -E "graph/requirement|error TS" | head -20
```

Expected: no errors referencing `graph/requirement-analysis-graph.ts`.

Common errors and fixes:
- `Cannot find module '@langchain/langgraph'` → Task 1 step 1 was not completed.
- `Property 'reducer' does not exist` → The installed langgraph version uses `value` instead of `reducer`. Change every `reducer: (_, b) => b` to `value: (_, b) => b`.
- `Type 'Partial<RequirementState>' is not assignable` → Add `as Partial<RequirementState>` cast to each node return.

- [ ] **Step 3: Commit**

```bash
git add services/chat/src/llm/graph/requirement-analysis-graph.ts
git commit -m "feat(chat): add LangGraph RequirementAnalysisState and linear graph"
```

---

## Task 3: Update OrchestratorService to delegate to the graph

**Files:**
- Modify: `services/chat/src/llm/agents/orchestrator.service.ts`

### What changes

- Remove: the five `createXxxAgent(this.model).invoke(...)` calls and `Promise.all`.
- Add: a single `runAnalysisGraph(this.model, input, skipClarification)` call.
- Keep: `parseJson`, `OrchestratorStep`, `OrchestratorResult` interfaces, and the reconstruction logic that builds the result from raw agent outputs.
- The reconstruction logic reads `state.extracted`, `state.clarified`, `state.analysis`, `state.risk`, `state.summary` instead of local variables.

> **Note on linear edges vs early return:** The linear graph runs all 5 nodes even when `needsClarification === true`. The OrchestratorService still returns `needs_clarification` early (before using `state.analysis`/`state.risk`/`state.summary`) so the final response is identical to the old chain. The extra LLM calls in the clarification case are a known trade-off of keeping linear edges; a conditional edge could be added later if latency matters.

- [ ] **Step 1: Replace the orchestrate method body**

Replace the entire content of `services/chat/src/llm/agents/orchestrator.service.ts` with:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_CONFIG } from '../llm.constants.js';
import type { LlmConfig } from '../model.factory.js';
import { createChatModel } from '../model.factory.js';
import { runAnalysisGraph } from '../graph/requirement-analysis-graph.js';

export interface OrchestratorStep {
  agent: string;
  parallel: boolean;
  output: string;
}

export interface OrchestratorResult {
  mode: 'fixed';
  status: 'completed' | 'needs_clarification' | 'failed';
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  steps: OrchestratorStep[];
  report?: string;
}

function parseJson(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

@Injectable()
export class OrchestratorService {
  private readonly model: ChatOpenAI;

  constructor(@Inject(LLM_CONFIG) config: LlmConfig) {
    this.model = createChatModel(config);
  }

  async orchestrate(input: string, skipClarification = false): Promise<OrchestratorResult> {
    const steps: OrchestratorStep[] = [];
    const usedAgents: string[] = [];

    try {
      const state = await runAnalysisGraph(this.model, input, skipClarification);

      // ── Step 1 result ──────────────────────────────────────────────────────
      steps.push({ agent: 'extractAgent', parallel: false, output: state.extracted });
      usedAgents.push('extractAgent');

      // ── Step 2 result ──────────────────────────────────────────────────────
      if (!skipClarification) {
        steps.push({ agent: 'clarifyAgent', parallel: false, output: state.clarified });
        usedAgents.push('clarifyAgent');

        const clarify = parseJson(state.clarified);
        if (clarify?.needsClarification === true) {
          return {
            mode: 'fixed',
            status: 'needs_clarification',
            clarificationQuestions: clarify.questions ?? [],
            usedAgents,
            steps,
          };
        }
      }

      // ── Step 3 result ──────────────────────────────────────────────────────
      steps.push({ agent: 'analysisAgent', parallel: true, output: state.analysis });
      steps.push({ agent: 'riskAgent',     parallel: true, output: state.risk });
      usedAgents.push('analysisAgent', 'riskAgent');

      // ── Step 4 result ──────────────────────────────────────────────────────
      steps.push({ agent: 'summaryAgent', parallel: false, output: state.summary });
      usedAgents.push('summaryAgent');

      return {
        mode: 'fixed',
        status: 'completed',
        usedAgents,
        steps,
        report: state.summary,
      };
    } catch {
      return {
        mode: 'fixed',
        status: 'failed',
        usedAgents,
        fallback: 'manual_review',
        steps,
      };
    }
  }
}
```

- [ ] **Step 2: Typecheck the whole service**

```bash
cd services/chat && bun run typecheck 2>&1 | grep "error TS" | head -20
```

Expected: zero `error TS` lines.

- [ ] **Step 3: Commit**

```bash
git add services/chat/src/llm/agents/orchestrator.service.ts
git commit -m "refactor(chat): delegate orchestration to LangGraph requirement analysis graph"
```

---

## Task 4: Functional verification

**Goal:** confirm `POST /api/agents/orchestrate` returns the same shape as before.

- [ ] **Step 1: Start the backend**

```bash
cd services/chat && bun run dev
```

Wait for `Chat service running on http://localhost:8081`.

- [ ] **Step 2: Send a test request**

```bash
curl -s -X POST http://localhost:8081/api/agents/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"input":"开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文","skipClarification":true}' \
  | jq '{status, usedAgents, reportLen: (.report | length)}'
```

Expected output shape:
```json
{
  "status": "completed",
  "usedAgents": ["extractAgent", "analysisAgent", "riskAgent", "summaryAgent"],
  "reportLen": <number greater than 200>
}
```

If `status` is `"failed"`, check the NestJS console for the underlying error.

- [ ] **Step 3: Verify clarification path still works**

```bash
curl -s -X POST http://localhost:8081/api/agents/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"input":"做一个系统"}' \
  | jq '{status, clarificationQuestions}'
```

Expected: `status` is `"needs_clarification"` and `clarificationQuestions` is a non-empty array (or `"completed"` if the LLM judges the input sufficient — both are valid).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify LangGraph migration — orchestration path confirmed"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] New file `services/chat/src/llm/graph/requirement-analysis-graph.ts` — Task 2
- [x] `Annotation.Root + MessagesAnnotation.spec` with all 6 fields — Task 2 Step 1
- [x] Business fields use overwrite reducer `(_, b) => b` — Task 2 Step 1
- [x] Five nodes extract/clarify/analysis/risk/summary — Task 2 Step 1
- [x] Nodes reuse the existing agent factories from `sub-agents.ts` — Task 2 Step 1
- [x] Linear edges `START → extract → clarify → analysis → risk → summary → END` — Task 2 Step 1
- [x] Export `createAnalysisGraph()` and `runAnalysisGraph()` — Task 2 Step 1
- [x] Original `orchestrator.service.ts` retained, delegates to graph — Task 3
- [x] Verification with same input — Task 4

**Known trade-off documented:** With linear edges, all 5 nodes run even when clarification is needed. The `OrchestratorService` returns early in that case so the HTTP response is correct; the extra LLM calls (analysis/risk/summary) are the cost of keeping linear edges per the spec.
