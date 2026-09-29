#!/usr/bin/env python3
"""Julia-1 decision sidecar for the player-loop gauntlet.

The service only chooses among caller-supplied candidates. It has no Mineflayer
or game-control interface; execution remains deterministic in minecraft-mbot.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from julia import load_model

HOST = os.environ.get("JULIA_HOST", "127.0.0.1")
PORT = int(os.environ.get("JULIA_PORT", "8768"))
MODEL = os.environ.get("JULIA_MODEL", "Julia-1")
DEVICE = os.environ.get("JULIA_DEVICE", "cpu")
MAX_BODY_BYTES = 1_000_000
MAX_CANDIDATES = 20

engine = None
engine_lock = threading.Lock()


def normalize_candidates(values: Any) -> list[dict[str, str]]:
    if not isinstance(values, list) or not values or len(values) > MAX_CANDIDATES:
        raise ValueError("candidates must be a non-empty list (max 20)")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("candidate must be an object")
        candidate_id = str(value.get("id", ""))
        description = str(value.get("description", "")).strip()
        if not re.fullmatch(r"[a-z0-9_:-]{1,80}", candidate_id) or candidate_id in seen:
            raise ValueError("invalid or duplicate candidate id")
        if not description or len(description) > 1000:
            raise ValueError("invalid candidate description")
        seen.add(candidate_id)
        out.append({"id": candidate_id, "description": description})
    return out


def load() -> None:
    global engine
    engine = load_model(
        MODEL,
        device=DEVICE,
        strict_encoding=True,
        max_length=8192,
        head_length=512,
    )


def choose(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = normalize_candidates(payload.get("candidates"))
    if len(candidates) == 1:
        return {
            "choice": candidates[0]["id"],
            "confidence": 1.0,
            "model_calls": 0,
            "latency_ms": 0.0,
            "source": "forced_single_candidate",
        }
    state = payload.get("state")
    if not isinstance(state, dict):
        raise ValueError("state must be an object")
    if engine is None:
        raise RuntimeError("Julia-1 model is not loaded")

    criteria = {candidate["id"]: candidate["description"] for candidate in candidates}
    questions = {
        "intent": {
            "type": "choice",
            "instructions": (
                "Choose exactly one Minecraft survival intention for the next decision cycle. "
                "Consider immediate danger, health, hunger, equipment, inventory, base access, "
                "objective progress, recent failures and whether preparation is needed first. "
                "Only choose from the supplied criteria."
            ),
            "criteria": criteria,
        }
    }

    started = time.perf_counter()
    with engine_lock:
        result = engine.predict(
            state=json.dumps(state, ensure_ascii=False, sort_keys=True),
            questions=questions,
        )
    latency_ms = (time.perf_counter() - started) * 1000.0

    answer = result["answers"]["intent"]
    choice = str(answer["choice"])
    if choice not in criteria:
        raise ValueError("model returned an action outside supplied candidates")

    probabilities = {
        str(key): float(value)
        for key, value in dict(answer.get("probabilities") or {}).items()
        if str(key) in criteria
    }
    confidence = answer.get("confidence", answer.get("answer_confidence", probabilities.get(choice)))
    return {
        "choice": choice,
        "confidence": None if confidence is None else float(confidence),
        "probabilities": probabilities,
        "model_calls": 1,
        "latency_ms": latency_ms,
        "source": "julia-1",
        "rss_mb": process_rss_mb(),
    }


def process_rss_mb() -> float | None:
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / (1024 if os.name != "darwin" else 1024 * 1024)
    except Exception:
        return None


class Handler(BaseHTTPRequestHandler):
    def respond(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            return self.respond(200, {
                "ok": engine is not None,
                "engine": "julia-1",
                "model": MODEL,
                "device": DEVICE,
            })
        self.respond(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/choose":
            return self.respond(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length))
            result = choose(payload)
            self.respond(200, result)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            detail = str(exc)
            invalid_model_output = "outside supplied candidates" in detail
            self.respond(
                422 if invalid_model_output else 400,
                {"error": "invalid_choice" if invalid_model_output else "invalid_request", "detail": detail},
            )
        except Exception as exc:
            self.respond(503, {"error": "inference_failed", "detail": str(exc)[:300]})

    def log_message(self, *_: Any) -> None:
        pass


def main() -> None:
    load()
    print(f"Julia-1 selector ready at http://{HOST}:{PORT}/choose device={DEVICE}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
