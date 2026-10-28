#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "sentence-transformers",
#   "transformers",
#   "torch",
#   "torchvision",
#   "pillow",
#   "numpy",
#   "psutil",
# ]
# ///

"""EmbeddingGemma 2 offline benchmark over real Minecraft bot experience logs.

No Minecraft actions are executed. The script only ranks prior episodes and
reports whether retrieved memories match/usefully support the current decision.

Temporal rule: for a query episode decided at time T, only episodes whose outcome
had already settled strictly before T are retrievable (never the episode itself,
never the future). Only contested decisions (2+ candidates) are scored by default.

Compared methods: random, recency, exact rule match, TF-IDF (fit on the allowed
past only) and EmbeddingGemma 2 at Matryoshka dimensions 128/256/512/768.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import os
import platform
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

MODEL_ID = "google/embeddinggemma-2"
DIMENSIONS = (128, 256, 512, 768)
RULE_FEATURES = (("threat", 1), ("threatDistance", 1), ("health", 1), ("food", 1), ("objective", 1), ("candidateSet", 2))


# ---------------------------------------------------------------- corpus / temporal

def load_corpus(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    episodes = data.get("episodes", [])
    if not isinstance(episodes, list):
        raise SystemExit("invalid corpus: episodes must be a list")
    episodes = sorted(episodes, key=lambda e: str(e.get("settledAt") or ""))
    return data, episodes


def allowed_indices(settled, episodes, i):
    n = bisect.bisect_left(settled, str(episodes[i].get("decidedAt") or ""))
    return [j for j in range(n) if j != i]


def is_positive(e):
    f = e.get("flags") or {}
    return bool(e.get("success")) and not (f.get("safety") or f.get("cancelled") or f.get("blocked") or f.get("healthLost"))


def memory_utility(target, mem):
    """Utility of retrieving `mem` while deciding `target` (higher is better).

    +1.0  same action as the decision, positive historical outcome
    +0.5  other action that is available now (in target candidates), positive outcome
    -0.5  available action whose outcome was failed/cancelled/blocked
    -1.0  available action with safety violation or health loss
    -0.25 action not available now (memory from a different situation)
    -0.25 extra when the situation category differs
    """
    f = mem.get("flags") or {}
    if mem.get("action") not in (target.get("candidates") or []):
        u = -0.25
    elif is_positive(mem):
        u = 1.0 if mem.get("action") == target.get("action") else 0.5
    elif f.get("safety") or f.get("healthLost"):
        u = -1.0
    else:
        u = -0.5
    if mem.get("category") != target.get("category"):
        u -= 0.25
    return u


# ---------------------------------------------------------------- scorers

def rule_scores(target, pool):
    tf = target.get("features") or {}
    out = np.zeros(len(pool), dtype=np.float64)
    for n, e in enumerate(pool):
        ef = e.get("features") or {}
        out[n] = sum(w for k, w in RULE_FEATURES if ef.get(k) == tf.get(k))
    return out


TOKEN = re.compile(r"[a-z_]+|\d+")


def tokens(text):
    return TOKEN.findall(text.lower())


def tfidf_scores(query, docs):
    df = Counter()
    toks = [Counter(tokens(d)) for d in docs]
    for t in toks:
        df.update(t.keys())
    n = len(docs)
    idf = {w: math.log((1 + n) / (1 + c)) + 1.0 for w, c in df.items()}

    def vec(tc):
        v = {w: (1 + math.log(c)) * idf.get(w, 0.0) for w, c in tc.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {w: x / norm for w, x in v.items()}

    q = vec(Counter(tokens(query)))
    return np.array([sum(q.get(w, 0.0) * x for w, x in vec(t).items()) for t in toks], dtype=np.float64)


def order_by(scores, pool_idx):
    # higher score first; ties -> most recent first (deterministic)
    keys = np.lexsort((-np.asarray(pool_idx, dtype=np.float64), -scores))
    return [pool_idx[k] for k in keys]


# ---------------------------------------------------------------- evaluation

def evaluate(name, episodes, targets, rank_fn, top_k):
    rows = []
    for i, pool in targets:
        t0 = time.perf_counter()
        ranked = rank_fn(i, pool)
        search_ms = (time.perf_counter() - t0) * 1000
        rows.append(score_row(episodes, i, ranked, top_k, search_ms))
    return summarize(name, rows, top_k)


def score_row(episodes, i, ranked, top_k, search_ms=None):
    t = episodes[i]
    act = t.get("action")
    rank = next((r for r, j in enumerate(ranked, 1) if episodes[j].get("action") == act), None)
    top = ranked[:top_k]
    return {
        "queryEpisode": t.get("id"),
        "category": t.get("category"),
        "targetAction": act,
        "targetSuccess": bool(t.get("success")),
        "poolSize": len(ranked),
        "firstSameActionRank": rank,
        "top1Same": bool(ranked) and episodes[ranked[0]].get("action") == act,
        "usefulAtK": any(episodes[j].get("action") == act and is_positive(episodes[j]) for j in top),
        "utilityAtK": float(np.mean([memory_utility(t, episodes[j]) for j in top])) if top else 0.0,
        "searchMs": search_ms,
        "retrieved": [{"episode": episodes[j].get("id"), "action": episodes[j].get("action"),
                       "success": episodes[j].get("success"), "code": episodes[j].get("code")} for j in top],
    }


def summarize(name, rows, top_k):
    def agg(rs):
        n = len(rs)
        if not n:
            return {"n": 0}
        hit = lambda k: round(sum(1 for r in rs if r["firstSameActionRank"] and r["firstSameActionRank"] <= k) / n, 4)
        return {
            "n": n,
            "top1SameAction": round(sum(r["top1Same"] for r in rs) / n, 4),
            "hit@1": hit(1), "hit@3": hit(3), "hit@5": hit(5),
            "mrr": round(sum(1 / r["firstSameActionRank"] for r in rs if r["firstSameActionRank"]) / n, 4),
            f"usefulAt{top_k}": round(sum(r["usefulAtK"] for r in rs) / n, 4),
            f"memoryUtilityAt{top_k}": round(sum(r["utilityAtK"] for r in rs) / n, 4),
        }

    by_cat = defaultdict(list)
    by_act = defaultdict(list)
    for r in rows:
        by_cat[r["category"]].append(r)
        by_act[r["targetAction"]].append(r)
    lat = [r["searchMs"] for r in rows if r["searchMs"] is not None]
    return {
        "method": name,
        "overall": agg(rows),
        "byCategory": {k: agg(v) for k, v in sorted(by_cat.items())},
        "actionRecallAt3": {k: agg(v)["hit@3"] for k, v in sorted(by_act.items())},
        "actionCounts": {k: len(v) for k, v in sorted(by_act.items())},
        "searchMs": {"mean": round(float(np.mean(lat)), 3), "p50": round(float(np.percentile(lat, 50)), 3),
                     "p95": round(float(np.percentile(lat, 95)), 3)} if lat else None,
        "rows": rows,
    }


def paired_bootstrap(a_rows, b_rows, key, n=2000, seed=7):
    """Mean difference a-b with 95% bootstrap CI over the same queries."""
    a = np.array([float(r[key]) for r in a_rows])
    b = np.array([float(r[key]) for r in b_rows])
    d = a - b
    rng = np.random.default_rng(seed)
    boots = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(n)]
    return {"meanDiff": round(float(d.mean()), 4), "ci95": [round(float(np.percentile(boots, 2.5)), 4),
                                                             round(float(np.percentile(boots, 97.5)), 4)]}


# ---------------------------------------------------------------- embeddings

def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.clip(n, 1e-12, None)


def truncate(vec, dimensions):
    vec = np.asarray(vec, dtype=np.float32)
    if dimensions and dimensions < vec.shape[-1]:
        vec = vec[..., :dimensions]
    return normalize(vec)


class Embedder:
    """Encodes once at native 768d (Matryoshka); smaller dims are prefix-truncated + renormalized."""

    def __init__(self, model_id, cache_dir: Path, revision=None):
        import psutil
        from sentence_transformers import SentenceTransformer

        self.proc = psutil.Process()
        self.rss_before_mb = self.proc.memory_info().rss / 1e6
        t0 = time.perf_counter()
        # text only: vision/audio encoders are not needed for state text
        self.model = SentenceTransformer(model_id, device="cpu", revision=revision,
                                         config_kwargs={"vision_config": None, "audio_config": None})
        self.load_seconds = time.perf_counter() - t0
        self.rss_after_load_mb = self.proc.memory_info().rss / 1e6
        self.model_id = model_id
        self.revision = revision or resolve_revision(model_id)
        self.cache_path = cache_dir / f"bench-{hashlib.sha1((model_id + str(self.revision)).encode()).hexdigest()[:12]}.npz"
        self.cache = {}
        if self.cache_path.exists():
            with np.load(self.cache_path, allow_pickle=False) as z:
                self.cache = {k: z[k] for k in z.files}

    def encode(self, texts, prompt_name):
        keys = [hashlib.sha1(f"{prompt_name}\0{t}".encode()).hexdigest() for t in texts]
        missing = sorted({k: t for k, t in zip(keys, texts) if k not in self.cache}.items())
        if missing:
            vec = self.model.encode([t for _, t in missing], prompt_name=prompt_name, convert_to_numpy=True,
                                    show_progress_bar=False, batch_size=32)
            for (k, _), v in zip(missing, vec):
                self.cache[k] = np.asarray(v, dtype=np.float32)
        return np.stack([self.cache[k] for k in keys])

    def save(self):
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(self.cache_path, **self.cache)

    def query_latency(self, texts, n=60):
        out = []
        for t in texts[:n]:
            t0 = time.perf_counter()
            self.model.encode([t], prompt_name="SearchQuery", convert_to_numpy=True, show_progress_bar=False)
            out.append((time.perf_counter() - t0) * 1000)
        return {"n": len(out), "mean": round(float(np.mean(out)), 2), "p50": round(float(np.percentile(out, 50)), 2),
                "p95": round(float(np.percentile(out, 95)), 2)}


def resolve_revision(model_id):
    try:
        from huggingface_hub import HfApi
        return HfApi().model_info(model_id).sha
    except Exception:
        return None


def environment_info(embedder=None):
    import importlib.metadata as md
    import psutil

    def ver(p):
        try:
            return md.version(p)
        except Exception:
            return None

    cpu = platform.processor() or None
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    except Exception:
        pass
    info = {
        "os": platform.platform(), "python": platform.python_version(), "cpu": cpu,
        "cpuCount": os.cpu_count(), "ramTotalGB": round(psutil.virtual_memory().total / 1e9, 2), "device": "cpu",
        "torch": ver("torch"), "transformers": ver("transformers"), "sentenceTransformers": ver("sentence-transformers"),
        "numpy": ver("numpy"),
    }
    if embedder:
        info.update({"model": embedder.model_id, "modelRevision": embedder.revision,
                     "modalitiesLoaded": "text-only (vision_config=None, audio_config=None)",
                     "modelLoadSeconds": round(embedder.load_seconds, 3),
                     "rssBeforeLoadMB": round(embedder.rss_before_mb, 1),
                     "rssAfterLoadMB": round(embedder.rss_after_load_mb, 1)})
    return info


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True, type=Path)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--revision", default=None)
    ap.add_argument("--dimensions", default="128,256,512,768")
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--warmup", type=int, default=3, help="minimum retrievable past episodes before scoring a query")
    ap.add_argument("--all-decisions", action="store_true",
                    help="also score forced/single-candidate decisions (diagnostic only)")
    ap.add_argument("--ablation-dim", type=int, default=256)
    ap.add_argument("--no-gemma", action="store_true", help="baselines only (no model download)")
    ap.add_argument("--cache-dir", type=Path, default=Path(".data/embedding-memory"))
    ap.add_argument("--output-dir", type=Path, required=True)
    args = ap.parse_args()
    dims = [int(d) for d in args.dimensions.split(",") if d]
    for d in dims:
        if d not in DIMENSIONS:
            raise SystemExit(f"unsupported dimension {d}; EmbeddingGemma 2 supports {DIMENSIONS}")

    corpus, episodes = load_corpus(args.corpus)
    settled = [str(e.get("settledAt") or "") for e in episodes]
    targets = []
    skipped = Counter()
    for i, e in enumerate(episodes):
        if not args.all_decisions and len(e.get("candidates") or []) < 2:
            skipped["forced"] += 1
            continue
        pool = allowed_indices(settled, episodes, i)
        if len(pool) < args.warmup:
            skipped["warmup"] += 1
            continue
        targets.append((i, pool))
    if not targets:
        raise SystemExit("no evaluable decisions")

    k = args.top_k
    results = {}
    results["random"] = evaluate("random", episodes, targets,
                                 lambda i, pool: list(np.random.default_rng(1000 + i).permutation(pool)), k)
    results["recency"] = evaluate("recency", episodes, targets, lambda i, pool: sorted(pool, reverse=True), k)
    results["rule_match"] = evaluate("rule_match", episodes, targets,
                                     lambda i, pool: order_by(rule_scores(episodes[i], [episodes[j] for j in pool]), pool), k)

    def tfidf_rank(variant):
        return lambda i, pool: order_by(tfidf_scores(episodes[i]["variants"][variant]["query"],
                                                     [episodes[j]["variants"][variant]["document"] for j in pool]), pool)

    # outcome-aware rule match: same structured match, prefers historically positive episodes.
    # Uses only history-side outcome (allowed), never the query's own outcome.
    results["rule_match_outcome"] = evaluate("rule_match_outcome", episodes, targets, lambda i, pool: order_by(
        rule_scores(episodes[i], [episodes[j] for j in pool])
        + np.array([0.5 if is_positive(episodes[j]) else 0.0 for j in pool]), pool), k)
    results["tfidf"] = evaluate("tfidf", episodes, targets, tfidf_rank("full"), k)
    results["tfidf_compact"] = evaluate("tfidf_compact", episodes, targets, tfidf_rank("compact"), k)

    env = environment_info()
    gemma = {}
    ablations = {}
    indexing = {}
    if not args.no_gemma:
        emb = Embedder(args.model, args.cache_dir, args.revision)
        env = environment_info(emb)
        variants = list(episodes[0]["variants"].keys())
        vecs = {}
        for v in variants:
            t0 = time.perf_counter()
            dq = emb.encode([e["variants"][v]["document"] for e in episodes], "Document")
            qq = emb.encode([e["variants"][v]["query"] for e in episodes], "SearchQuery")
            indexing[v] = round(time.perf_counter() - t0, 2)
            vecs[v] = (dq, qq)
        emb.save()
        env["rssAfterIndexMB"] = round(emb.proc.memory_info().rss / 1e6, 1)
        env["queryEncodeLatencyMs"] = emb.query_latency([episodes[i]["query"] for i, _ in targets])

        def gemma_rank(v, d):
            docs = truncate(vecs[v][0], d)
            qs = truncate(vecs[v][1], d)
            return lambda i, pool: order_by((docs[pool] @ qs[i]).astype(np.float64), pool)

        for rep in ("full", "compact"):
            for d in dims:
                r = evaluate(f"gemma_{d}_{rep}", episodes, targets, gemma_rank(rep, d), k)
                r["representation"] = rep
                r["indexBytes"] = len(episodes) * d * 4
                r["indexSeconds768AllDocsAndQueries"] = indexing[rep]
                gemma[f"{d}" if rep == "full" else f"{d}-compact"] = r
        for v in variants:
            ablations[v] = {
                "gemma": evaluate(f"gemma_{args.ablation_dim}_{v}", episodes, targets, gemma_rank(v, args.ablation_dim), k),
                "tfidf": evaluate(f"tfidf_{v}", episodes, targets, tfidf_rank(v), k),
            }

    comparisons = {}
    heldout = {}
    if gemma:
        best_d = max(gemma, key=lambda d: gemma[d]["overall"][f"memoryUtilityAt{k}"])
        for base in ("recency", "rule_match", "rule_match_outcome", "tfidf", "tfidf_compact"):
            for d in gemma:
                comparisons[f"gemma_{d}_vs_{base}"] = {
                    "top1SameAction": paired_bootstrap(gemma[d]["rows"], results[base]["rows"], "top1Same"),
                    f"usefulAt{k}": paired_bootstrap(gemma[d]["rows"], results[base]["rows"], "usefulAtK"),
                    f"memoryUtilityAt{k}": paired_bootstrap(gemma[d]["rows"], results[base]["rows"], "utilityAtK"),
                }
        comparisons["bestGemmaConfigByUtility"] = best_d
        # The compact representation was chosen after looking at ablations; report the
        # chronologically later half of queries separately as a less-biased check.
        half = len(targets) // 2
        for name, r in [*results.items(), *((f"gemma_{d}", g) for d, g in gemma.items())]:
            heldout[name] = summarize(name, r["rows"][half:], k)["overall"]

    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    meta = {"executionAuthority": "none", "evaluationMode": "all" if args.all_decisions else "contested_only",
            "temporalRule": "retrievable = episodes with settledAt < query.decidedAt (excluding itself)",
            "topK": k, "warmup": args.warmup, "evaluated": len(targets), "skipped": dict(skipped),
            "episodes": len(episodes)}

    def write(name, body):
        (out / name).write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    write("environment.json", env)
    write("corpus-stats.json", corpus.get("stats", {}))
    write("baseline-random.json", {**meta, **results["random"]})
    write("baseline-recency.json", {**meta, **results["recency"]})
    write("baseline-rule-match.json", {**meta, **results["rule_match"]})
    write("baseline-rule-match-outcome.json", {**meta, **results["rule_match_outcome"]})
    write("baseline-tfidf.json", {**meta, **results["tfidf"]})
    write("baseline-tfidf-compact.json", {**meta, **results["tfidf_compact"]})
    for d, r in gemma.items():
        write(f"benchmark-{d}.json", {**meta, "model": args.model, "modelRevision": env.get("modelRevision"),
                                      "dimensions": d, **r})
    strip = lambda r: {kk: vv for kk, vv in r.items() if kk != "rows"}
    if ablations:
        write("ablations.json", {**meta, "dimensions": args.ablation_dim, "indexSecondsPerVariant": indexing,
                                 "variants": {v: {m: strip(x) for m, x in a.items()} for v, a in ablations.items()}})
    table = {name: {**r["overall"], "searchMs": r["searchMs"]} for name, r in results.items()}
    for d, r in gemma.items():
        table[f"gemma_{d}"] = {**r["overall"], "searchMs": r["searchMs"], "indexBytes": r["indexBytes"]}
    summary = {**meta, "model": args.model, "modelRevision": env.get("modelRevision"), "table": table,
               "comparisons": comparisons, "heldoutSecondHalf": heldout,
               "ablationsOverall": {v: {m: x["overall"] for m, x in a.items()} for v, a in ablations.items()}}
    write("summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
