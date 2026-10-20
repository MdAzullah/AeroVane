import unittest

from check_model_release import assess


POLICY = {
    "gate": "test",
    "minimums": {"independent_test_groups": 2, "normal_test_flights": 1, "anomalous_test_flights": 1, "recall": 0.8, "macro_f1": 0.6},
    "maximums": {"window_false_warning_rate": 0.1, "clean_flights_with_warning_rate": 0.1, "brier_score": 0.1, "expected_calibration_error": 0.1},
    "requirements": {"test_evaluations": 1, "advisory_only": True, "component_diagnosis_allowed": False},
}


def report():
    return {
        "experiment": "fixture", "test_evaluations": 1,
        "fresh_cohort": {"group_count": 2, "development_group_overlap": 0, "development_hash_overlap": 0},
        "fresh_test": {"recall": 0.9, "false_warning_rate": 0.0},
        "fresh_test_calibration": {"brier_score": 0.05, "expected_calibration_error": 0.05},
        "fresh_test_per_flight": {"macro_f1": 0.8, "items": {
            "normal": {"tp": 0, "fn": 0, "fp": 0},
            "anomaly": {"tp": 9, "fn": 1, "fp": 0},
        }},
    }


class ReleaseGateTests(unittest.TestCase):
    def test_complete_independent_evidence_passes(self):
        self.assertTrue(assess(POLICY, report(), external_dataset=True)["release_ready"])

    def test_missing_external_evidence_fails(self):
        result = assess(POLICY, report())
        self.assertFalse(result["release_ready"])
        self.assertFalse(next(item for item in result["checks"] if item["check"] == "external_dataset_or_collection")["pass"])

    def test_clean_flight_warning_is_measured_per_flight(self):
        candidate = report()
        candidate["fresh_test_per_flight"]["items"]["normal"]["fp"] = 1
        result = assess(POLICY, candidate, external_dataset=True)
        self.assertFalse(next(item for item in result["checks"] if item["check"] == "clean_flights_with_warning_rate")["pass"])


if __name__ == "__main__":
    unittest.main()
