"""Unit tests for the offline EmbeddingGemma 2 benchmark (no model download).

Run: python -m unittest discover -s test/python
"""

import importlib.util
import unittest
from pathlib import Path

try:
    import numpy as np  # noqa: F401
except ImportError:  # pragma: no cover
    np = None

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "embeddinggemma2-memory-benchmark.py"


def load():
    spec = importlib.util.spec_from_file_location("bench", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ep(i, decided, settled, action="a", cands=("a", "b"), ok=True, cat="THREAT", flags=None):
    return {"id": f"e{i}", "decidedAt": decided, "settledAt": settled, "action": action, "candidates": list(cands),
            "success": ok, "category": cat, "flags": flags or {}, "features": {"candidateSet": "+".join(sorted(cands))}}


@unittest.skipIf(np is None, "numpy not installed")
class BenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.b = load()

    def test_allowed_indices_excludes_self_future_and_unsettled(self):
        eps = sorted([
            ep(0, "t00", "t10"),
            ep(1, "t05", "t60"),  # still running when 2 is decided
            ep(2, "t20", "t30"),
            ep(3, "t40", "t50"),
        ], key=lambda e: e["settledAt"])
        settled = [e["settledAt"] for e in eps]
        names = lambda i: [eps[j]["id"] for j in self.b.allowed_indices(settled, eps, i)]
        idx = {e["id"]: i for i, e in enumerate(eps)}
        self.assertEqual(names(idx["e0"]), [])
        self.assertEqual(names(idx["e2"]), ["e0"])
        self.assertEqual(names(idx["e3"]), ["e0", "e2"])
        self.assertEqual(names(idx["e1"]), [])
        for i in range(len(eps)):
            for j in self.b.allowed_indices(settled, eps, i):
                self.assertLess(eps[j]["settledAt"], eps[i]["decidedAt"])

    def test_memory_utility_rewards_positive_compatible_and_penalizes_failures(self):
        t = ep(9, "t", "u", action="a", cands=("a", "b"))
        u = self.b.memory_utility
        self.assertEqual(u(t, ep(1, "", "", action="a")), 1.0)
        self.assertEqual(u(t, ep(1, "", "", action="b")), 0.5)
        self.assertEqual(u(t, ep(1, "", "", action="a", ok=False)), -0.5)
        self.assertEqual(u(t, ep(1, "", "", action="a", flags={"safety": True})), -1.0)
        self.assertEqual(u(t, ep(1, "", "", action="a", flags={"cancelled": True})), -0.5)
        self.assertEqual(u(t, ep(1, "", "", action="zzz")), -0.25)
        self.assertEqual(u(t, ep(1, "", "", action="a", cat="FOOD")), 0.75)

    def test_score_row_and_top_k(self):
        eps = [ep(0, "", "", action="b"), ep(1, "", "", action="a"), ep(2, "", "", action="a", ok=False),
               ep(3, "", "", action="a")]
        row = self.b.score_row(eps, 3, [0, 2, 1], top_k=2)
        self.assertEqual(row["firstSameActionRank"], 2)
        self.assertFalse(row["top1Same"])
        self.assertFalse(row["usefulAtK"])  # only failing 'a' within top-2
        self.assertEqual(len(row["retrieved"]), 2)

    def test_order_by_breaks_ties_by_recency(self):
        import numpy
        self.assertEqual(self.b.order_by(numpy.array([1.0, 1.0, 2.0]), [4, 7, 5]), [5, 7, 4])

    def test_truncate_dimension_renormalizes(self):
        import numpy
        v = self.b.truncate(numpy.ones((2, 768)), 128)
        self.assertEqual(v.shape, (2, 128))
        self.assertTrue(numpy.allclose(numpy.linalg.norm(v, axis=1), 1.0))

    def test_tfidf_prefers_lexically_closer_document(self):
        s = self.b.tfidf_scores("zombie close escape", ["spider far shelter", "zombie close weapon"])
        self.assertGreater(s[1], s[0])


if __name__ == "__main__":
    unittest.main()
