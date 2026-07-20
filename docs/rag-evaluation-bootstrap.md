# RAG evaluation bootstrap

This initial setup proves the CI wiring before a reviewed legal evaluation
dataset and judge credentials are available.

## What bootstrap mode proves

The workflow exercises this complete path:

1. Load `services/chat/test/fixtures/rag-eval-set.json`.
2. Read each sample's explicitly synthetic `bootstrap` RAG output.
3. Calculate offline Recall@K, MRR and NDCG@K.
4. Call the Python evaluator through `POST /evaluate`.
5. Write `artifacts/rag-evaluation/result.json` and `summary.md`.
6. Compare every metric with `thresholds.json` and set an exit code.

`RAGAS_MOCK=true` makes the evaluator return zero for each generation metric.
All thresholds are initially zero. The report always records
`bootstrapMode: true` and warns that the result is not a quality measurement.

## Run locally

Install the Python service once:

```powershell
cd services/ragas-evaluator
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[test]"
```

Start it in one PowerShell terminal:

```powershell
$env:RAGAS_MOCK='true'
.venv\Scripts\python -m uvicorn ragas_evaluator.app:app --host 127.0.0.1 --port 8000
```

Run the pipeline in a second terminal from `services/chat`:

```powershell
$env:RAG_EVAL_BOOTSTRAP_MODE='true'
$env:RAGAS_MOCK='true'
$env:RAGAS_SERVICE_URL='http://127.0.0.1:8000'
bun run scripts/run-rag-evaluation.ts
```

## Move to real evaluation

1. Replace the samples with reviewed legal questions and stable document IDs.
2. Start the real NestJS service with the fixed evaluation corpus ingested.
3. Set `RAG_EVAL_RAG_ENDPOINT` to its authenticated `/api/rag-demo/ask`
   endpoint and provide `RAG_EVAL_RAG_TOKEN`.
4. Set `RAG_EVAL_BOOTSTRAP_MODE=false` and `RAGAS_MOCK=false`.
5. Configure the RAGAS model environment variables documented in
   `services/ragas-evaluator/README.md`.
6. Install the real evaluator dependencies with
   `python -m pip install -e ".[real]"`.
7. Raise the thresholds only after recording and reviewing a baseline.

Exit codes are `0` for pass, `1` for a quality threshold failure and `2` for
an evaluation infrastructure failure.
