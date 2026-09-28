from __future__ import annotations

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path


class FakeRouter:
    def __init__(self, preload=False):
        self.preload = preload
        self.calls = []

    def predict(self, state, questions):
        self.calls.append((state, questions))
        criteria = questions["action"]["criteria"]
        keys = list(criteria)
        choice = keys[0]
        probabilities = {
            key: (0.8 if key == choice else 0.2 / max(1, len(keys) - 1))
            for key in keys
        }
        return {
            "answers": {
                "action": {
                    "choice": choice,
                    "confidence": 0.8,
                    "probabilities": probabilities,
                }
            },
            "routing": {"model": "english"},
        }


def load_module():
    sys.modules["laya"] = types.SimpleNamespace(Router=FakeRouter)
    path = Path(__file__).resolve().parents[1] / "scripts" / "laya-decision-server.py"
    spec = importlib.util.spec_from_file_location("laya_decision_server_tested", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class LayaSidecarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["LAYA_SKIP_WARMUP"] = "1"
        cls.module = load_module()

    def setUp(self):
        self.module.router.calls.clear()

    def test_actions_are_canonical_and_filtered(self):
        self.assertEqual(
            self.module.ordered_actions(["wait", "fight", "unknown", "fight"]),
            ["fight", "wait"],
        )

    def test_single_action_is_forced_without_model_call(self):
        result = self.module.decide({
            "state": {"health": 20},
            "available_actions": ["wait"],
        })
        self.assertEqual(result["action"], "wait")
        self.assertEqual(result["model_calls"], 0)
        self.assertEqual(self.module.router.calls, [])

    def test_direct_choice_uses_only_available_actions(self):
        result = self.module.decide({
            "state": {"health": 20, "food": 18},
            "available_actions": ["fight", "move", "wait"],
        })
        self.assertEqual(result["action"], "move")
        self.assertTrue(result["trusted"])
        self.assertEqual(result["routing"]["model"], "english")
        self.assertEqual(len(self.module.router.calls), 1)

        state, questions = self.module.router.calls[0]
        self.assertEqual(
            list(questions["action"]["criteria"]),
            ["move", "fight", "wait"],
        )
        self.assertEqual(
            [item["id"] for item in state["available_actions"]],
            ["move", "fight", "wait"],
        )

    def test_no_supported_action_is_rejected(self):
        with self.assertRaises(ValueError):
            self.module.decide({
                "state": {},
                "available_actions": ["bash"],
            })

    def test_unavailable_model_choice_is_rejected(self):
        class BadRouter:
            def predict(self, state, questions):
                return {
                    "answers": {
                        "action": {
                            "choice": "stop",
                            "confidence": 0.9,
                            "probabilities": {"stop": 0.9},
                        }
                    },
                    "routing": {"model": "english"},
                }

        before = self.module.router
        self.module.router = BadRouter()
        try:
            with self.assertRaises(ValueError):
                self.module.decide({
                    "state": {},
                    "available_actions": ["gather", "wait"],
                })
        finally:
            self.module.router = before


if __name__ == "__main__":
    unittest.main()
