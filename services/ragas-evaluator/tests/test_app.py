from fastapi.testclient import TestClient

from ragas_evaluator.app import EvaluationRequest, create_app


REQUEST = {
    "samples": [
        {
            "question": "合同一方不履行义务，应承担什么责任？",
            "answer": "应承担违约责任。",
            "contexts": ["当事人一方不履行合同义务的，应当承担违约责任。"],
            "ground_truth": "应承担违约责任。",
        }
    ],
    "metrics": ["faithfulness", "answer_relevancy"],
}


def test_health() -> None:
    response = TestClient(create_app()).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_evaluate_uses_injected_evaluator() -> None:
    def evaluator(request: EvaluationRequest) -> dict[str, float]:
        assert request.samples[0].question.startswith("合同")
        return {metric: 0.5 for metric in request.metrics}

    response = TestClient(create_app(evaluator)).post("/evaluate", json=REQUEST)
    assert response.status_code == 200
    assert response.json() == {"faithfulness": 0.5, "answer_relevancy": 0.5}


def test_bootstrap_mode_returns_zero_scores(monkeypatch) -> None:
    monkeypatch.setenv("RAGAS_MOCK", "true")
    response = TestClient(create_app()).post("/evaluate", json=REQUEST)
    assert response.status_code == 200
    assert response.json() == {"faithfulness": 0.0, "answer_relevancy": 0.0}


def test_unknown_metric_returns_400() -> None:
    request = {**REQUEST, "metrics": ["not_a_metric"]}
    response = TestClient(create_app()).post("/evaluate", json=request)
    assert response.status_code == 400


def test_empty_samples_returns_422() -> None:
    request = {**REQUEST, "samples": []}
    response = TestClient(create_app()).post("/evaluate", json=request)
    assert response.status_code == 422


def test_non_finite_result_returns_503() -> None:
    response = TestClient(create_app(lambda _request: {"faithfulness": float("nan"), "answer_relevancy": 0.5})).post(
        "/evaluate", json=REQUEST
    )
    assert response.status_code == 503
