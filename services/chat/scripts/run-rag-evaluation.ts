import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mrr, ndcgAtK, recallAtK } from '../rag/evaluation/retrieval-metrics.js';
import { runRagasEvaluation } from '../rag/evaluation/ragas-runner.js';

const RAGAS_METRICS = [
  'faithfulness',
  'answer_relevancy',
  'context_precision',
  'context_recall',
] as const;

interface BootstrapOutput {
  answer: string;
  contexts: string[];
  retrievedDocIds: string[];
}

interface EvaluationCase {
  id: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  question: string;
  expectedDocIds: string[];
  groundTruth: string;
  bootstrap?: BootstrapOutput;
}

interface Thresholds {
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  faithfulness: number;
  answer_relevancy: number;
  context_precision: number;
  context_recall: number;
  highRiskPassRate: number;
}

interface RagOutput extends BootstrapOutput {}

function isBootstrapMode(): boolean {
  return process.env.RAG_EVAL_BOOTSTRAP_MODE?.toLowerCase() === 'true';
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
}

function parseCases(value: unknown): EvaluationCase[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Evaluation dataset must not be empty');
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`Sample ${index} must be an object`);
    const sample = item as Record<string, unknown>;
    for (const field of ['id', 'category', 'riskLevel', 'question', 'groundTruth']) {
      if (typeof sample[field] !== 'string' || sample[field] === '') {
        throw new Error(`Sample ${index}.${field} must be a non-empty string`);
      }
    }
    assertStringArray(sample.expectedDocIds, `Sample ${index}.expectedDocIds`);
    return sample as unknown as EvaluationCase;
  });
}

function parseThresholds(value: unknown): Thresholds {
  if (typeof value !== 'object' || value === null) throw new Error('Thresholds must be an object');
  const data = value as Record<string, unknown>;
  const names: Array<keyof Thresholds> = [
    'recallAtK', 'mrr', 'ndcgAtK', 'faithfulness', 'answer_relevancy',
    'context_precision', 'context_recall', 'highRiskPassRate',
  ];
  for (const name of names) {
    if (typeof data[name] !== 'number' || !Number.isFinite(data[name])) {
      throw new Error(`Threshold ${name} must be a finite number`);
    }
  }
  return data as unknown as Thresholds;
}

async function queryRag(sample: EvaluationCase, bootstrapMode: boolean): Promise<RagOutput> {
  if (bootstrapMode) {
    if (!sample.bootstrap) throw new Error(`Sample ${sample.id} has no bootstrap output`);
    return sample.bootstrap;
  }

  const endpoint = process.env.RAG_EVAL_RAG_ENDPOINT;
  if (!endpoint) throw new Error('RAG_EVAL_RAG_ENDPOINT is required outside bootstrap mode');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.RAG_EVAL_RAG_TOKEN) headers.authorization = `Bearer ${process.env.RAG_EVAL_RAG_TOKEN}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question: sample.question, topK: 5 }),
  });
  if (!response.ok) throw new Error(`RAG endpoint returned HTTP ${response.status} for ${sample.id}`);
  const data = await response.json() as {
    answer?: unknown;
    citations?: Array<{ documentId?: unknown; quote?: unknown }>;
  };
  if (typeof data.answer !== 'string' || !Array.isArray(data.citations)) {
    throw new Error(`RAG endpoint returned an invalid response for ${sample.id}`);
  }
  return {
    answer: data.answer,
    contexts: data.citations
      .map(citation => citation.quote)
      .filter((quote): quote is string => typeof quote === 'string'),
    retrievedDocIds: data.citations
      .map(citation => citation.documentId)
      .filter((id): id is string => typeof id === 'string'),
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function markdownReport(result: Record<string, unknown>, failures: string[]): string {
  const summary = result.summary as Record<string, number>;
  const rows = Object.entries(summary)
    .map(([metric, score]) => `| ${metric} | ${score.toFixed(4)} |`)
    .join('\n');
  return [
    '# RAG evaluation report',
    '',
    `> Mode: **${result.bootstrapMode ? 'BOOTSTRAP (wiring only; not a quality result)' : 'REAL'}**`,
    '',
    `Generated: ${result.generatedAt}`,
    '',
    '| Metric | Score |',
    '| --- | ---: |',
    rows,
    '',
    failures.length ? `Failures: ${failures.join(', ')}` : 'All configured zero thresholds passed.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, '../../..');
  const datasetPath = process.env.RAG_EVAL_DATASET
    ? resolve(process.env.RAG_EVAL_DATASET)
    : resolve(scriptDirectory, '../test/fixtures/rag-eval-set.json');
  const thresholdsPath = process.env.RAG_EVAL_THRESHOLDS
    ? resolve(process.env.RAG_EVAL_THRESHOLDS)
    : resolve(scriptDirectory, '../rag/evaluation/thresholds.json');
  const artifactsDirectory = resolve(repositoryRoot, 'artifacts/rag-evaluation');
  const bootstrapMode = isBootstrapMode();

  if (bootstrapMode && process.env.RAGAS_MOCK?.toLowerCase() !== 'true') {
    throw new Error('Bootstrap evaluation requires RAGAS_MOCK=true on the evaluator service');
  }

  const cases = parseCases(JSON.parse(await readFile(datasetPath, 'utf8')));
  const thresholds = parseThresholds(JSON.parse(await readFile(thresholdsPath, 'utf8')));
  const evaluated = [];

  for (const sample of cases) {
    const output = await queryRag(sample, bootstrapMode);
    const retrievalApplicable = sample.expectedDocIds.length > 0;
    evaluated.push({
      ...sample,
      bootstrap: undefined,
      ...output,
      retrievalApplicable,
      recallAtK: retrievalApplicable
        ? recallAtK(output.retrievedDocIds, sample.expectedDocIds, 5)
        : null,
      ndcgAtK: retrievalApplicable
        ? ndcgAtK(output.retrievedDocIds, sample.expectedDocIds, 5)
        : null,
    });
  }

  const ragas = await runRagasEvaluation({
    samples: evaluated.map(sample => ({
      question: sample.question,
      answer: sample.answer,
      contexts: sample.contexts,
      ground_truth: sample.groundTruth,
    })),
    metrics: [...RAGAS_METRICS],
  });
  if (ragas === null) throw new Error('RAGAS evaluator is unavailable; no threshold decision was made');

  const retrievalSamples = evaluated.filter(sample => sample.retrievalApplicable);
  const summary = {
    recallAtK: average(retrievalSamples.map(sample => sample.recallAtK!)),
    mrr: mrr(
      retrievalSamples.map(sample => sample.retrievedDocIds),
      retrievalSamples.map(sample => sample.expectedDocIds),
    ),
    ndcgAtK: average(retrievalSamples.map(sample => sample.ndcgAtK!)),
    ...ragas,
    highRiskPassRate: 0,
  };
  const failures = Object.entries(thresholds)
    .filter(([metric, threshold]) => (summary[metric as keyof typeof summary] ?? 0) < threshold)
    .map(([metric, threshold]) => `${metric} < ${threshold}`);
  const result = {
    schemaVersion: 1,
    bootstrapMode,
    warning: bootstrapMode
      ? 'Synthetic outputs and mock RAGAS scores validate wiring only; they do not measure RAG quality.'
      : undefined,
    generatedAt: new Date().toISOString(),
    datasetPath,
    thresholds,
    summary,
    failures,
    samples: evaluated,
  };

  await mkdir(artifactsDirectory, { recursive: true });
  await writeFile(resolve(artifactsDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(resolve(artifactsDirectory, 'summary.md'), markdownReport(result, failures), 'utf8');
  console.log(markdownReport(result, failures));
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(`[RAG evaluation infrastructure error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
