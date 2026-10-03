#!/usr/bin/env python3
"""Local Laya decision service for minecraft-mbot.

Endpoints:
- POST /decision: legacy high-level Minecraft action choice
- POST /choose: generic player-loop intention choice with neutral option keys

The model only chooses among caller-supplied, prevalidated candidates. Tool
arguments and deterministic execution remain outside the model.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

os.environ.setdefault("USE_TF", "0")

try:
    from laya import Router
except ImportError as exc:
    raise SystemExit(
        "Laya is not installed. Run: python -m pip install -r scripts/requirements-laya.txt"
    ) from exc

ACTION_ORDER = (
    "gather",
    "craft",
    "smelt",
    "eat",
    "move",
    "deposit",
    "withdraw",
    "build",
    "fight",
    "wait",
    "stop",
)

ACTION_CRITERIA = {
    "gather": "Collect the resource required by the current objective.",
    "craft": "Craft the item required by the current objective using available materials.",
    "smelt": "Smelt or cook the material required by the current objective.",
    "eat": "Eat available food to restore hunger when eating is appropriate now.",
    "move": "Move to a prepared destination or create distance from immediate danger.",
    "deposit": "Deposit carried resources into the configured shared storage.",
    "withdraw": "Withdraw a required item from configured shared storage.",
    "build": "Perform the prepared construction step for the current objective.",
    "fight": "Engage a nearby hostile entity when combat is the appropriate immediate action.",
    "wait": "Do not start another high-level action this decision cycle.",
    "stop": "Stop the current objective because it is complete, cancelled, blocked, or unsafe to continue.",
}

MAX_BODY_BYTES = 1_000_000
MAX_CANDIDATES = 20
HOST = os.environ.get("LAYA_DECISION_HOST", "127.0.0.1")
PORT = int(os.environ.get("LAYA_DECISION_PORT", "8765"))

router = Router(preload=False)
inference_lock = threading.Lock()


def ordered_actions(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    available = {str(value) for value in values}
    return [action for action in ACTION_ORDER if action in available]


def model_state(state: Any, actions: list[str]) -> dict[str, Any]:
    source = dict(state) if isinstance(state, dict) else {}
    source["available_actions"] = [
        {"id": action, "meaning": ACTION_CRITERIA[action]}
        for action in actions
    ]
    source["decision_contract"] = (
        "Choose exactly one available high-level action. "
        "Do not invent tool arguments; those are prepared outside the model."
    )
    return source


def _confidence(answer: dict[str, Any], probabilities: dict[str, float], choice: str) -> float | None:
    raw = answer.get("confidence")
    if raw is None:
        raw = answer.get("answer_confidence", probabilities.get(choice))
    return None if raw is None else float(raw)


def decide(payload: dict[str, Any]) -> dict[str, Any]:
    actions = ordered_actions(payload.get("available_actions"))
    if not actions:
        raise ValueError("available_actions must contain at least one supported action")

    if len(actions) == 1:
        return {
            "action": actions[0],
            "confidence": 1.0,
            "probabilities": {actions[0]: 1.0},
            "trusted": True,
            "routing": {"model": "forced_single_action"},
            "model_calls": 0,
        }

    questions = {
        "action": {
            "type": "choice",
            "instructions": (
                "Choose exactly one action for the Minecraft bot to execute next. "
                "All listed actions are currently allowed. Use the state, objective, "
                "danger, hunger, progress, inventory, and recent failures to choose "
                "the best immediate high-level action."
            ),
            "criteria": {
                action: ACTION_CRITERIA[action]
                for action in actions
            },
        }
    }

    started = time.perf_counter()
    with inference_lock:
        result = router.predict(
            model_state(payload.get("state"), actions),
            questions,
        )
    latency_ms = (time.perf_counter() - started) * 1000.0

    answer = result["answers"]["action"]
    action = str(answer["choice"])
    if action not in actions:
        raise ValueError(f"Laya returned unavailable action: {action}")

    probabilities = {
        str(key): float(value)
        for key, value in dict(answer.get("probabilities") or {}).items()
        if str(key) in actions
    }

    return {
        "action": action,
        "confidence": _confidence(answer, probabilities, action),
        "probabilities": probabilities,
        "trusted": True,
        "routing": dict(result.get("routing") or {}),
        "latency_ms": latency_ms,
        "model_calls": 1,
    }


def normalize_candidates(values: Any) -> list[dict[str, str]]:
    if not isinstance(values, list) or not values:
        raise ValueError("candidates must be a non-empty list")
    if len(values) > MAX_CANDIDATES:
        raise ValueError(f"too many candidates; max={MAX_CANDIDATES}")

    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("candidate must be an object")
        candidate_id = str(value.get("id", ""))
        description = str(value.get("description", "")).strip()
        if not re.fullmatch(r"[a-z0-9_:-]{1,80}", candidate_id):
            raise ValueError(f"invalid candidate id: {candidate_id}")
        if candidate_id in seen:
            raise ValueError(f"duplicate candidate id: {candidate_id}")
        if not description or len(description) > 1000:
            raise ValueError(f"invalid description for candidate: {candidate_id}")
        seen.add(candidate_id)
        out.append({"id": candidate_id, "description": description})
    return out


def choose(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = normalize_candidates(payload.get("candidates"))

    if len(candidates) == 1:
        candidate_id = candidates[0]["id"]
        return {
            "choice": candidate_id,
            "confidence": 1.0,
            "probabilities": {candidate_id: 1.0},
            "trusted": True,
            "routing": {"model": "forced_single_candidate"},
            "model_calls": 0,
        }

    keys = [chr(ord("A") + index) for index in range(len(candidates))]
    by_key = dict(zip(keys, candidates))
    questions = {
        "intent": {
            "type": "choice",
            "instructions": (
                "Act like a Minecraft survival player. Choose exactly one high-level "
                "intention for the next decision cycle. Consider immediate danger, "
                "health, hunger, equipment, inventory, crafting capability, current "
                "objective, recent failures, base access, and whether preparation is "
                "needed before continuing. Prefer useful progress over passivity. "
                "Waiting is valid only when its option gives a concrete reason to wait."
            ),
            "criteria": {
                key: by_key[key]["description"]
                for key in keys
            },
        }
    }

    state = dict(payload.get("state") or {})
    state["decision_contract"] = (
        "Choose one of the neutral option keys. Options are mutually exclusive "
        "high-level intentions. Low-level execution is deterministic and happens "
        "after this choice."
    )

    started = time.perf_counter()
    with inference_lock:
        result = router.predict(state, questions)
    latency_ms = (time.perf_counter() - started) * 1000.0

    answer = result["answers"]["intent"]
    key = str(answer["choice"])
    if key not in by_key:
        raise ValueError(f"Laya returned invalid neutral option: {key}")

    chosen = by_key[key]["id"]
    raw_probabilities = dict(answer.get("probabilities") or {})
    probabilities = {
        by_key[option_key]["id"]: float(probability)
        for option_key, probability in raw_probabilities.items()
        if option_key in by_key
    }

    return {
        "choice": chosen,
        "confidence": _confidence(answer, probabilities, chosen),
        "probabilities": probabilities,
        "trusted": True,
        "routing": dict(result.get("routing") or {}),
        "latency_ms": latency_ms,
        "model_calls": 1,
        "neutral_option": key,
    }


def warmup() -> dict[str, Any] | None:
    """Load/cache the routed model before opening the HTTP port."""
    if os.environ.get("LAYA_SKIP_WARMUP") == "1":
        return None

    print("Loading Laya model before accepting requests...")
    started = time.perf_counter()
    result = decide({
        "state": {
            "objective": "Warm up the English Minecraft decision model.",
            "health": 20,
            "food": 20,
        },
        "available_actions": ["wait", "stop"],
    })
    elapsed = time.perf_counter() - started
    print(
        "Laya ready "
        f"(routing={result.get('routing')}, warmup={elapsed:.1f}s)"
    )
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "minecraft-mbot-laya/2"

    def _json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._json(200, {
                "ok": True,
                "engine": "laya",
                "endpoints": ["/decision", "/choose"],
            })
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path not in {"/decision", "/choose"}:
            self._json(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413, {"error": "invalid_body_size"})
                return

            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request body must be a JSON object")

            result = decide(payload) if self.path == "/decision" else choose(payload)
            self._json(200, result)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": "invalid_request", "detail": str(exc)})
        except Exception as exc:
            self._json(
                500,
                {
                    "error": "inference_error",
                    "detail": f"{type(exc).__name__}: {exc}",
                },
            )

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[laya] " + (fmt % args))


def main() -> None:
    warmup()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"Laya decision service listening on http://{HOST}:{PORT} "
        "(/decision, /choose)"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
