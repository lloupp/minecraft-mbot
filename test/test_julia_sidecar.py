import importlib.util
import pathlib
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "julia-decision-server.py"

fake_julia = types.ModuleType("julia")
fake_julia.load_model = lambda *args, **kwargs: None
sys.modules.setdefault("julia", fake_julia)

spec = importlib.util.spec_from_file_location("julia_decision_server", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeEngine:
    def __init__(self):
        self.criteria_orders = []

    def predict(self, *, state, questions):
        criteria = questions["intent"]["criteria"]
        self.criteria_orders.append(list(criteria.keys()))
        first = next(iter(criteria))
        return {
            "answers": {
                "intent": {
                    "choice": first,
                    "probabilities": {key: (1.0 if key == first else 0.0) for key in criteria},
                    "confidence": 1.0,
                }
            }
        }


class JuliaSidecarCandidateOrderTests(unittest.TestCase):
    def test_normalize_candidates_is_canonical_by_id(self):
        values = [
            {"id": "gather_materials", "description": "Gather materials."},
            {"id": "continue_objective", "description": "Continue objective."},
        ]
        reversed_values = list(reversed(values))

        a = module.normalize_candidates(values)
        b = module.normalize_candidates(reversed_values)

        self.assertEqual(a, b)
        self.assertEqual(
            [candidate["id"] for candidate in a],
            ["continue_objective", "gather_materials"],
        )

    def test_choose_presents_same_criteria_order_for_both_input_orders(self):
        engine = FakeEngine()
        module.engine = engine
        state = {"health": 20, "food": 20, "objective": {"type": "explore"}}
        candidates = [
            {"id": "gather_materials", "description": "Gather missing materials."},
            {"id": "continue_objective", "description": "Continue current objective."},
        ]

        module.choose({"state": state, "candidates": candidates})
        module.choose({"state": state, "candidates": list(reversed(candidates))})

        self.assertEqual(engine.criteria_orders[0], engine.criteria_orders[1])
        self.assertEqual(
            engine.criteria_orders[0],
            ["continue_objective", "gather_materials"],
        )


if __name__ == "__main__":
    unittest.main()
