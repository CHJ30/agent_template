/**
 * In-memory per-session / per-request node lifecycle store.
 *
 * Designed to be called from the orchestrator's stream loop — no framework DI
 * needed. Data is ephemeral (process lifetime only).
 *
 * Memory caps: MAX_SESSIONS × MAX_REQUESTS_PER_SESSION traces.
 */

export interface ExpertTiming {
  durationMs: number;
  error: boolean;
}

export interface NodeTrace {
  node: string;
  label: string;
  startedAt: number;
  latencyMs: number;
  meta?: {
    intent?: 'analyze' | 'query' | 'chat';
    reviseCount?: number;
    expertTimings?: Record<string, ExpertTiming>;
  };
}

export interface RequestTrace {
  requestId: string;
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  totalMs?: number;
  intent?: 'analyze' | 'query' | 'chat';
  reviseCount: number;
  nodes: NodeTrace[];
  expertTimings?: Record<string, ExpertTiming>;
  status?: 'completed' | 'needs_clarification' | 'awaiting_review' | 'failed' | 'error';
}

const MAX_SESSIONS = 200;
const MAX_REQUESTS_PER_SESSION = 20;

const LABELS: Record<string, string> = {
  classifier:   '意图识别',
  extractStep:  '需求提取',
  clarifyStep:  '澄清检查',
  analysisStep: '多维度分析',
  riskStep:     '风险评估',
  summaryStep:  '报告生成',
  humanReviewStep: '人工评审',
  humanRefineStep: '人工意见修订',
  queryHandler: '需求查询',
  chatHandler:  '闲聊对话',
};

interface ActiveRequest {
  trace: RequestTrace;
  nodeStartedAt: Map<string, number>;
}

class NodeTracerStore {
  private readonly sessions = new Map<string, RequestTrace[]>();
  private readonly active   = new Map<string, ActiveRequest>();

  startRequest(sessionId: string, requestId: string): void {
    const trace: RequestTrace = {
      requestId,
      sessionId,
      startedAt: Date.now(),
      reviseCount: 0,
      nodes: [],
    };
    this.active.set(requestId, { trace, nodeStartedAt: new Map() });
  }

  /** Called when an agent_start event is about to be emitted for a node. */
  nodeStarted(requestId: string, node: string): void {
    this.active.get(requestId)?.nodeStartedAt.set(node, Date.now());
  }

  /** Called when the graph update for a node has been received. */
  nodeEnded(requestId: string, node: string, meta?: NodeTrace['meta']): void {
    const ar = this.active.get(requestId);
    if (!ar) return;

    const startedAt = ar.nodeStartedAt.get(node) ?? ar.trace.startedAt;
    ar.nodeStartedAt.delete(node);
    const latencyMs = Date.now() - startedAt;

    ar.trace.nodes.push({ node, label: LABELS[node] ?? node, startedAt, latencyMs, meta });

    if (meta?.intent)               ar.trace.intent        = meta.intent;
    if (meta?.reviseCount !== undefined) ar.trace.reviseCount = meta.reviseCount;
    if (meta?.expertTimings)        ar.trace.expertTimings = meta.expertTimings;
  }

  endRequest(requestId: string, status: RequestTrace['status']): void {
    const ar = this.active.get(requestId);
    if (!ar) return;
    this.active.delete(requestId);

    const t = ar.trace;
    t.endedAt = Date.now();
    t.totalMs = t.endedAt - t.startedAt;
    t.status  = status;

    if (!this.sessions.has(t.sessionId)) {
      if (this.sessions.size >= MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value;
        if (oldest !== undefined) this.sessions.delete(oldest);
      }
      this.sessions.set(t.sessionId, []);
    }
    const list = this.sessions.get(t.sessionId)!;
    list.push(t);
    if (list.length > MAX_REQUESTS_PER_SESSION) list.shift();
  }

  getSession(sessionId: string): RequestTrace[] {
    return this.sessions.get(sessionId) ?? [];
  }

  getLastRequest(sessionId: string): RequestTrace | null {
    const list = this.sessions.get(sessionId);
    return list?.[list.length - 1] ?? null;
  }
}

export const nodeTracer = new NodeTracerStore();
