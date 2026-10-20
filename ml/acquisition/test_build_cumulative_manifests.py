import copy
import unittest

from build_cumulative_manifests import combine


def cohort(number, digest, flight, group, windows, coverage=1.0):
    identity = {"source_id": "source", "source_version": "revision"}
    return {
        "inventory": identity | {"files": [{"relative_path": f"candidate-{number}.ulg", "size_bytes": number,
                                               "sha256": digest, "format": "ulog", "duplicate_of": None}]},
        "labels": identity | {"label_provenance": "expert_review", "records": [{"flight_id": flight, "sha256": digest}]},
        "groups": identity | {"records": [{"flight_id": flight, "sha256": digest, "group_id": group}]},
        "splits": identity | {"training_authorized": False, "records": [{"flight_id": flight, "sha256": digest,
                                                                            "group_id": group, "split": "excluded"}]},
        "quality": {"schema_version": "1.0.0", "window_ms": 5000.0, "stride_ms": 2500.0,
                    "boundary_padding_ms": 2000.0, "window_count": windows, "label_counts": {"normal": windows},
                    "split_counts": {"excluded": windows}, "per_split_label_counts": {"excluded": {"normal": windows}},
                    "feature_window_coverage": {"feature": coverage},
                    "per_flight": [{"flight_id": flight, "windows": windows, "labels": {"normal": windows}}],
                    "privacy": {"location_features": False}, "model_fitted": False},
    }


class CumulativeManifestTests(unittest.TestCase):
    def setUp(self):
        self.one = cohort(1, "a" * 64, "flight-001", "grp-one", 2)
        self.two = cohort(2, "b" * 64, "flight-002", "grp-two", 3, 2 / 3)

    def test_combines_lineage_and_weights_coverage(self):
        result = combine([self.one, self.two], "2026-09-27T00:00:00Z")
        self.assertEqual([r["flight_id"] for r in result["labels"]["records"]], ["flight-001", "flight-002"])
        self.assertEqual(result["quality"]["window_count"], 5)
        self.assertEqual(result["quality"]["feature_window_coverage"]["feature"], 0.8)
        self.assertFalse(result["splits"]["training_authorized"])

    def test_rejects_duplicate_hash_across_cohorts(self):
        changed = copy.deepcopy(self.two)
        for kind in ("inventory", "labels", "groups", "splits"):
            changed[kind]["records" if kind != "inventory" else "files"][0]["sha256"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "duplicate sha256"):
            combine([self.one, changed], "2026-09-27T00:00:00Z")

    def test_rejects_active_or_authorized_input(self):
        changed = copy.deepcopy(self.two)
        changed["splits"]["training_authorized"] = True
        with self.assertRaisesRegex(ValueError, "prohibit training"):
            combine([self.one, changed], "2026-09-27T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
