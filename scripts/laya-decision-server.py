#!/usr/bin/env python3
"""Local Laya decision service for minecraft-mbot.

POST /decision
{
  "state": {...},
  "available_actions": ["gather", "wait", ...]
}

The model chooses only a high-level action ID. Tool arguments remain prepared
and validated by the Node side.
"""

from __future__ import annotations

import json
import os
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

    raw_confidence = answer.get("confidence")
    if raw_confidence is None:
        raw_confidence = answer.get(
            "answer_confidence",
            probabilities.get(action),
        )

    confidence = None if raw_confidence is None else float(raw_confidence)

    return {
        "action": action,
        "confidence": confidence,
        "probabilities": probabilities,
        "trusted": True,
        "routing": dict(result.get("routing") or {}),
        "latency_ms": latency_ms,
        "model_calls": 1,
    }


def warmup() -> dict[str, Any] | None:
    """Load/cache the routed model before opening the HTTP port.

    A cold Laya process can take much longer than the normal request timeout to
    load weights for the first time. The service advertises readiness only
    after this warmup succeeds.
    """
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
    server_version = "minecraft-mbot-laya/1"

    def _json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._json(200, {"ok": True, "engine": "laya"})
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/decision":
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

            self._json(200, decide(payload))
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
    print(f"Laya decision service listening on http://{HOST}:{PORT}/decision")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
