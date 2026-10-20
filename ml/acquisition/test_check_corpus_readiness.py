import copy
import unittest

from check_corpus_readiness import assess


class CorpusReadinessTests(unittest.TestCase):
    def setUp(self):
        self.policy = {"gate": "test", "required_labels_per_active_split": ["normal", "anomalous"], "minimums": {
            "independent_groups": 2, "eligible_flights": 2, "normal_only_flights": 1,
            "anomalous_flights": 1, "normal_windows": 2, "anomalous_windows": 1,
            "feature_window_coverage": 0.9, "train_groups": 1,
            "validation_groups": 1, "test_groups": 0,
        }}
        self.quality = {"per_flight": [
            {"labels": {"normal": 2}}, {"labels": {"normal": 1, "anomalous": 1}}
        ], "label_counts": {"normal": 3, "anomalous": 1},
            "feature_window_coverage": {"a": 1.0}, "model_fitted": False,
            "per_split_label_counts": {
                "train": {"normal": 1, "anomalous": 1},
                "validation": {"normal": 1, "anomalous": 1},
                "test": {"normal": 1, "anomalous": 1}
            }}
        self.groups = {"source_id": "source", "source_version": "rev", "records": [
            {"group_id": "g1"}, {"group_id": "g2"}
        ]}
        self.splits = {"status": "frozen", "training_authorized": True, "records": [
            {"flight_id": "f1", "group_id": "g1", "split": "train"},
            {"flight_id": "f2", "group_id": "g2", "split": "validation"}
        ]}
        self.quality["per_flight"][0]["flight_id"] = "f1"
        self.quality["per_flight"][1]["flight_id"] = "f2"
        self.registry = {"sources": [{"id": "source", "decision": "approved"}]}

    def test_ready_corpus_passes(self):
        self.assertTrue(assess(self.policy, self.quality, self.groups, self.splits, self.registry)["ready"])

    def test_quarantined_source_fails(self):
        changed = copy.deepcopy(self.registry)
        changed["sources"][0]["decision"] = "quarantined"
        report = assess(self.policy, self.quality, self.groups, self.splits, changed)
        self.assertFalse(report["ready"])

    def test_missing_anomalies_reports_shortfall(self):
        changed = copy.deepcopy(self.quality)
        changed["per_flight"] = [{"labels": {"normal": 2}}]
        changed["label_counts"]["anomalous"] = 0
        for counts in changed["per_split_label_counts"].values():
            counts["anomalous"] = 0
        report = assess(self.policy, changed, self.groups, self.splits, self.registry)
        check = next(item for item in report["checks"] if item["check"] == "anomalous_windows")
        self.assertEqual(check["shortfall"], 1)

    def test_lowest_feature_coverage_controls_gate(self):
        changed = copy.deepcopy(self.quality)
        changed["feature_window_coverage"]["b"] = 0.5
        self.assertFalse(assess(self.policy, changed, self.groups, self.splits, self.registry)["ready"])

    def test_each_active_split_requires_both_labels(self):
        changed = copy.deepcopy(self.quality)
        changed["per_split_label_counts"]["test"] = {"normal": 1}
        report = assess(self.policy, changed, self.groups, self.splits, self.registry)
        check = next(item for item in report["checks"] if item["check"] == "test_label_coverage")
        self.assertFalse(check["pass"])

    def test_excluded_flights_and_windows_do_not_count(self):
        changed_quality = copy.deepcopy(self.quality)
        changed_quality["per_flight"].append({"flight_id": "excluded", "labels": {"normal": 100}})
        changed_quality["label_counts"]["normal"] = 103
        changed_quality["per_split_label_counts"]["excluded"] = {"normal": 100}
        report = assess(self.policy, changed_quality, self.groups, self.splits, self.registry)
        check = next(item for item in report["checks"] if item["check"] == "normal_windows")
        self.assertEqual(check["actual"], 3)


if __name__ == "__main__":
    unittest.main()
