# RAGAS evaluator

CI-only HTTP wrapper around the Python RAGAS library. It is intentionally not
part of the NestJS production process.

## Bootstrap mode

Bootstrap mode validates the dataset -> HTTP -> report -> threshold pipeline
without an API key and always returns `0.0` for requested RAGAS metrics. These
scores are wiring checks, not quality measurements.

```powershell
$env:RAGAS_MOCK='true'
python -m uvicorn ragas_evaluator.app:app --host 127.0.0.1 --port 8000
```

## Real mode

Set `RAGAS_MOCK=false` and configure:

- `RAGAS_OPENAI_API_KEY` (or `OPENAI_API_KEY`)
- `RAGAS_OPENAI_BASE_URL` (optional)
- `RAGAS_JUDGE_MODEL` (defaults to `gpt-4o-mini`)
- `RAGAS_EMBEDDING_MODEL` (defaults to `text-embedding-3-small`)

Install real-mode dependencies and test:

```bash
python -m pip install -e ".[real,test]"
python -m pytest
```
