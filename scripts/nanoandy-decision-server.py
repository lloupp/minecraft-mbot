#!/usr/bin/env python3
"""Offline NanoAndy selector. It has no Mineflayer or game-control interface."""
from __future__ import annotations

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
MODEL_ID = os.environ.get("NANOANDY_MODEL", "DedeProGames/NanoAndy-350M")
HOST = os.environ.get("NANOANDY_HOST", "127.0.0.1")
PORT = int(os.environ.get("NANOANDY_PORT", "8766"))
MAX_CANDIDATES = 20
model = tokenizer = None
model_lock = threading.Lock()


def normalize_candidates(values: Any) -> list[dict[str, str]]:
    if not isinstance(values, list) or not values or len(values) > MAX_CANDIDATES:
        raise ValueError("candidates must be a non-empty list (max 20)")
    out, seen = [], set()
    for item in values:
        if not isinstance(item, dict):
            raise ValueError("candidate must be an object")
        cid, description = str(item.get("id", "")), str(item.get("description", "")).strip()
        if not re.fullmatch(r"[a-z0-9_:-]{1,80}", cid) or cid in seen:
            raise ValueError("invalid or duplicate candidate id")
        if not description or len(description) > 1000:
            raise ValueError("invalid candidate description")
        seen.add(cid)
        out.append({"id": cid, "description": description})
    return out


def parse_candidate_choice(raw: str, candidates: list[dict[str, str]]) -> str:
    match = re.search(r"\{[^{}]*\}", raw)
    if not match:
        raise ValueError("model did not return a JSON candidate choice")
    parsed = json.loads(match.group(0))
    choice = parsed.get("choice") if isinstance(parsed, dict) else None
    allowed = {candidate["id"] for candidate in candidates}
    if choice not in allowed:
        raise ValueError("model returned an action outside supplied candidates")
    return choice


def load_model() -> None:
    global model, tokenizer
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, torch_dtype=torch.float32, low_cpu_mem_usage=True
    ).to("cpu")
    model.eval()


def choose(payload: dict[str, Any]) -> dict[str, Any]:
    candidates = normalize_candidates(payload.get("candidates"))
    if len(candidates) == 1:
        return {"choice": candidates[0]["id"], "model_calls": 0,
                "latency_ms": 0.0, "source": "forced_single_candidate"}
    if model is None or tokenizer is None:
        raise RuntimeError("NanoAndy model is not loaded")
    state = payload.get("state")
    if not isinstance(state, dict):
        raise ValueError("state must be an object")
    # Candidate IDs are the only legal output tokens at the semantic layer;
    # parsing rejects any free-form/invented action before returning to caller.
    prompt = (
        "You are a Minecraft survival decision model. Select exactly one candidate. "
        "Consider survival, threat, equipment, resources, base, goal and prior results. "
        "Return only JSON: {\"choice\":\"candidate_id\"}. Never create actions.\n"
        + json.dumps({"state": state, "candidates": candidates}, ensure_ascii=False)
        + "\nJSON:"
    )
    started = time.perf_counter()
    import torch
    with model_lock, torch.inference_mode():
        inputs = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            add_generation_prompt=True, tokenize=True, return_dict=True,
            return_tensors="pt"
        )
    output = model.generate(**inputs, max_new_tokens=48, do_sample=False,
                                pad_token_id=tokenizer.eos_token_id)
    raw = tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    choice = parse_candidate_choice(raw, candidates)
    return {"choice": choice, "model_calls": 1,
            "latency_ms": (time.perf_counter() - started) * 1000,
            "source": "nanoandy", "raw_choice": choice,
            "rss_mb": process_rss_mb()}


def process_rss_mb() -> float | None:
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / (1024 if os.name != "darwin" else 1024 * 1024)
    except Exception:
        return None


class Handler(BaseHTTPRequestHandler):
    def respond(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            return self.respond(200, {"ok": model is not None, "engine": "nanoandy"})
        self.respond(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/choose":
            return self.respond(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("invalid request size")
            result = choose(json.loads(self.rfile.read(length)))
            self.respond(200, result)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            detail = str(exc)
            invalid_model_output = "outside supplied candidates" in detail or "did not return a JSON candidate choice" in detail
            status = 422 if invalid_model_output else 400
            self.respond(status, {"error": "invalid_choice" if status == 422 else "invalid_request", "detail": detail})
        except Exception as exc:
            self.respond(503, {"error": "inference_failed", "detail": str(exc)[:300]})

    def log_message(self, *_: Any) -> None:
        pass


def main() -> None:
    load_model()
    print(f"NanoAndy selector ready at http://{HOST}:{PORT}/choose", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
