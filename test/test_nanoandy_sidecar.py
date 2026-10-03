import importlib.util
import unittest
from pathlib import Path


def load_module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "nanoandy-decision-server.py"
    spec = importlib.util.spec_from_file_location("nanoandy_sidecar_tested", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NanoAndySidecarTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_forced_single_candidate_skips_generation(self):
        result = self.module.choose({"state": {"health": 6}, "candidates": [
            {"id": "escape_danger", "description": "Escape now."}
        ]})
        self.assertEqual(result["choice"], "escape_danger")
        self.assertEqual(result["model_calls"], 0)

    def test_rejects_untrusted_or_duplicate_candidate_ids(self):
        for candidates in [
            [{"id": "invented action", "description": "bad"}],
            [{"id": "escape_danger", "description": "one"},
             {"id": "escape_danger", "description": "duplicate"}],
        ]:
            with self.assertRaises(ValueError):
                self.module.choose({"state": {}, "candidates": candidates})

    def test_model_output_must_match_a_supplied_candidate_exactly(self):
        candidates = [{"id": "escape_danger", "description": "Escape."}]
        self.assertEqual(self.module.parse_candidate_choice(
            '{"choice":"escape_danger"}', candidates), "escape_danger")
        with self.assertRaises(ValueError):
            self.module.parse_candidate_choice('{"choice":"mineflayer_attack"}', candidates)


if __name__ == "__main__":
    unittest.main()
