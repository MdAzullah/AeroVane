import unittest

from model_contract import score, validate_artifact


def artifact():
    return {
        "schema_version": "1.0.0", "model_kind": "binary-decision-tree", "version": "test",
        "advisory_only": True, "features": ["a", "b"], "imputation_medians": [2.0, 3.0],
        "persistence_windows": 2, "decision_threshold": 0.5, "lineage": {},
        "tree": {"feature_index": [0, -1, -1], "threshold": [1.5, -2.0, -2.0],
                 "left": [1, -1, -1], "right": [2, -1, -1], "anomaly_probability": [0.5, 0.1, 0.9]},
    }


class ModelContractTests(unittest.TestCase):
    def test_scores_both_branches_and_imputes(self):
        self.assertEqual(score(artifact(), [1.0, 8.0]), 0.1)
        self.assertEqual(score(artifact(), [2.0, 8.0]), 0.9)
        self.assertEqual(score(artifact(), [None, 8.0]), 0.9)

    def test_rejects_invalid_child(self):
        value = artifact(); value["tree"]["right"][0] = 99
        with self.assertRaisesRegex(ValueError, "invalid decision-tree node"):
            validate_artifact(value)


if __name__ == "__main__":
    unittest.main()
