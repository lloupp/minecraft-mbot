#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "sentence-transformers",
#   "transformers",
#   "torch",
#   "numpy",
# ]
# ///

"""EmbeddingGemma 2 offline benchmark over real Minecraft bot experience logs.

No Minecraft actions are executed. The script only ranks prior episodes and
reports whether semantically retrieved memories match/usefully support the
current action.
"""

from __future__ import annotations
import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_ID = "google/embeddinggemma-2"


def load_corpus(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    episodes = data.get("episodes", [])
    if not isinstance(episodes, list):
        raise SystemExit("invalid corpus: episodes must be a list")
    return episodes


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.clip(n, 1e-12, None)


def encode(model, texts, prompt_name, dimensions):
    vec = model.encode(
        texts,
        prompt_name=prompt_name,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    vec = np.asarray(vec, dtype=np.float32)
    if dimensions and dimensions < vec.shape[-1]:
        vec = vec[..., :dimensions]
    return normalize(vec)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--dimensions", type=int, default=256, choices=(128, 256, 512, 768))
    ap.add_argument("--warmup", type=int, default=3, help="minimum prior episodes before evaluating a query")
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0, help="0 = all episodes")
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()

    episodes = load_corpus(args.corpus)
    if args.limit > 0:
        episodes = episodes[: args.limit]
    if len(episodes) <= args.warmup:
        raise SystemExit(f"need more than {args.warmup} usable episodes, got {len(episodes)}")

    started = time.perf_counter()
    model = SentenceTransformer(args.model)
    load_s = time.perf_counter() - started

    docs = [e["document"] for e in episodes]
    queries = [e["query"] for e in episodes]

    t0 = time.perf_counter()
    doc_vecs = encode(model, docs, "Document", args.dimensions)
    query_vecs = encode(model, queries, "SearchQuery", args.dimensions)
    embed_s = time.perf_counter() - t0

    evaluated = 0
    top1_same_action = 0
    useful_at_k = 0
    recency_same_action = 0
    reciprocal_rank_sum = 0.0
    rows = []

    for i in range(args.warmup, len(episodes)):
        target = episodes[i]
        q = query_vecs[i]
        sims = doc_vecs[:i] @ q
        order = np.argsort(-sims)
        k = min(args.top_k, len(order))
        picked = [int(x) for x in order[:k]]
        target_action = target.get("action")

        evaluated += 1
        if picked and episodes[picked[0]].get("action") == target_action:
            top1_same_action += 1
        if episodes[i - 1].get("action") == target_action:
            recency_same_action += 1
        if any(episodes[j].get("action") == target_action and episodes[j].get("success") for j in picked):
            useful_at_k += 1

        rr = 0.0
        for rank, j in enumerate(order, start=1):
            if episodes[int(j)].get("action") == target_action:
                rr = 1.0 / rank
                break
        reciprocal_rank_sum += rr

        rows.append({
            "queryEpisode": target.get("id"),
            "targetAction": target_action,
            "retrieved": [
                {
                    "rank": rank + 1,
                    "episode": episodes[j].get("id"),
                    "action": episodes[j].get("action"),
                    "success": episodes[j].get("success"),
                    "score": round(float(sims[j]), 6),
                }
                for rank, j in enumerate(picked)
            ],
        })

    def rate(n):
        return round(n / evaluated, 4) if evaluated else 0.0

    summary = {
        "model": args.model,
        "dimensions": args.dimensions,
        "episodes": len(episodes),
        "evaluated": evaluated,
        "topK": args.top_k,
        "modelLoadSeconds": round(load_s, 3),
        "embeddingSeconds": round(embed_s, 3),
        "queriesPerSecond": round((len(episodes) * 2) / embed_s, 3) if embed_s > 0 else None,
        "semanticTop1SameAction": rate(top1_same_action),
        "recencyTop1SameAction": rate(recency_same_action),
        "semanticUsefulAtK": rate(useful_at_k),
        "mrrSameAction": round(reciprocal_rank_sum / evaluated, 4) if evaluated else 0.0,
        "executionAuthority": "none",
        "rows": rows,
    }

    body = json.dumps(summary, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(body + "\n", encoding="utf-8")
    print(body)


if __name__ == "__main__":
    main()
