export interface RagasSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

export interface RagasEvaluationInput {
  samples: RagasSample[];
  metrics: string[];
}

export type RagasEvaluationResult = Record<string, number>;

export interface RagasRunnerOptions {
  /** Base URL of the team's Python RAGAS service. */
  serviceUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

function isMetricResult(value: unknown): value is RagasEvaluationResult {
  return typeof value === 'object'
    && value !== null
    && Object.values(value).every(metric => typeof metric === 'number' && Number.isFinite(metric));
}

/**
 * CI-only adapter for the team's RAGAS REST wrapper. RAGAS itself is a Python
 * library and does not provide POST /evaluate by default.
 */
export async function runRagasEvaluation(
  input: RagasEvaluationInput,
  options: RagasRunnerOptions = {},
): Promise<RagasEvaluationResult | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? 60_000);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const serviceUrl = options.serviceUrl
    ?? process.env.RAGAS_SERVICE_URL
    ?? 'http://127.0.0.1:8000';
  const endpoint = `${serviceUrl.replace(/\/$/, '')}/evaluate`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`RAGAS service returned HTTP ${response.status}`);
      }
      const result: unknown = await response.json();
      if (!isMetricResult(result)) throw new Error('RAGAS service returned an invalid metric result');
      return result;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  console.warn(`[RAGAS] evaluation unavailable after ${maxAttempts} attempts: ${reason}`);
  return null;
}
