import math
import os
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


SUPPORTED_METRICS = {
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
}


class EvaluationSample(BaseModel):
    question: str = Field(min_length=1)
    answer: str
    contexts: list[str]
    ground_truth: str


class EvaluationRequest(BaseModel):
    samples: list[EvaluationSample] = Field(min_length=1)
    metrics: list[str] = Field(min_length=1)


Evaluator = Callable[[EvaluationRequest], dict[str, float]]


def _mock_evaluate(request: EvaluationRequest) -> dict[str, float]:
    """Exercise the HTTP/CI wiring without claiming meaningful quality scores."""
    return {metric: 0.0 for metric in request.metrics}


def _real_evaluate(request: EvaluationRequest) -> dict[str, float]:
    # Imports stay lazy so bootstrap mode and health checks need no model client.
    from datasets import Dataset
    from openai import AsyncOpenAI, OpenAI
    from ragas import evaluate
    from ragas.embeddings import embedding_factory
    from ragas.llms import llm_factory
    from ragas.metrics import (
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )

    metric_registry = {
        "faithfulness": faithfulness,
        "answer_relevancy": answer_relevancy,
        "context_precision": context_precision,
        "context_recall": context_recall,
    }
    api_key = os.environ.get("RAGAS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("RAGAS_OPENAI_API_KEY or OPENAI_API_KEY is required")

    base_url = os.environ.get("RAGAS_OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
    async_client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    sync_client = OpenAI(api_key=api_key, base_url=base_url)
    judge_model = os.environ.get("RAGAS_JUDGE_MODEL", "gpt-4o-mini")
    embedding_model = os.environ.get("RAGAS_EMBEDDING_MODEL", "text-embedding-3-small")

    llm = llm_factory(judge_model, client=async_client)
    embeddings = embedding_factory(
        "openai",
        model=embedding_model,
        client=sync_client,
        interface="modern",
    )
    dataset = Dataset.from_list([sample.model_dump() for sample in request.samples])
    result = evaluate(
        dataset=dataset,
        metrics=[metric_registry[name] for name in request.metrics],
        llm=llm,
        embeddings=embeddings,
        raise_exceptions=False,
    )

    frame = result.to_pandas()
    scores: dict[str, float] = {}
    for metric in request.metrics:
        values = frame[metric].dropna()
        score = float(values.mean()) if len(values) else 0.0
        scores[metric] = score if math.isfinite(score) else 0.0
    return scores


def create_app(evaluator: Evaluator | None = None) -> FastAPI:
    app = FastAPI(title="Autix RAGAS Evaluator", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "mode": "bootstrap" if os.environ.get("RAGAS_MOCK", "false").lower() == "true" else "real",
        }

    @app.post("/evaluate")
    def run_evaluation(request: EvaluationRequest) -> dict[str, float]:
        unknown = sorted(set(request.metrics) - SUPPORTED_METRICS)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown metrics: {unknown}")
        selected_evaluator = evaluator
        if selected_evaluator is None:
            selected_evaluator = (
                _mock_evaluate
                if os.environ.get("RAGAS_MOCK", "false").lower() == "true"
                else _real_evaluate
            )
        try:
            scores = selected_evaluator(request)
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=503, detail=f"Evaluation failed: {error}") from error

        if set(scores) != set(request.metrics):
            raise HTTPException(status_code=503, detail="Evaluator returned an incomplete metric result")
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in scores.values()):
            raise HTTPException(status_code=503, detail="Evaluator returned a non-finite metric result")
        return {name: float(value) for name, value in scores.items()}

    return app


app = create_app()

