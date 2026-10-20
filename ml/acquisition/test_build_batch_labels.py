import tempfile
import unittest
from pathlib import Path

from build_batch_labels import build, convert_annotation, source_key


class BatchLabelTests(unittest.TestCase):
    def test_source_locator_is_normalized(self):
        self.assertEqual(source_key("ulg_files/day/log.ulg"), "day/log")

    def test_ranged_anomaly_converts_microseconds_to_milliseconds(self):
        document = {"annotations": [{"class": "Altitude", "note": "private", "timestamp": "private", "ranges": [["Position.Z", [[1000, 3000]]]]}]}
        label, classes, ranges = convert_annotation(document, 0, 10)
        self.assertEqual(label, "anomalous")
        self.assertEqual(classes, ["Altitude"])
        self.assertEqual(ranges[0]["start"], 1.0)
        self.assertNotIn("note", ranges[0])

    def test_normal_has_no_ranges(self):
        self.assertEqual(convert_annotation({"annotations": [{"class": "Normal", "ranges": []}]}, 0, 10)[0], "normal")

    def test_unranged_anomaly_becomes_unknown(self):
        self.assertEqual(convert_annotation({"annotations": [{"class": "Mechanical", "ranges": []}]}, 0, 10)[0], "unknown")

    def test_outside_range_fails(self):
        document = {"annotations": [{"class": "Altitude", "ranges": [["x", [[20000, 30000]]]]}]}
        with self.assertRaisesRegex(ValueError, "outside parsed flight"):
            convert_annotation(document, 0, 10)

    def test_build_excludes_out_of_bounds_annotation_as_unknown(self):
        mapping = {"day/flight": {"annotations": [{"class": "Altitude", "ranges": [["x", [[20000, 30000]]]]}]}}
        private = {"mapping": {"candidate-001": "ulg_files/day/flight.ulg"}}
        proposal = {"records": [{"candidate_id": "candidate-001", "group_id": "grp-test"}]}
        inventory = {
            "source_id": "source", "source_version": "rev",
            "files": [{"relative_path": "candidate-001.ulg", "sha256": "a" * 64}],
        }
        with tempfile.TemporaryDirectory() as directory:
            canonical = Path(directory) / "candidate-001.jsonl"
            canonical.write_text('{"timestampMs":0}\n{"timestampMs":10}\n', encoding="utf-8")
            labels, _, splits = build(mapping, private, proposal, inventory, Path(directory), 1)
        record = labels["records"][0]
        self.assertEqual(record["window_label"], "unknown")
        self.assertFalse(record["training_eligible"])
        self.assertIn("outside parsed flight", record["exclusion_reason"])
        self.assertEqual(splits["records"][0]["split"], "excluded")


if __name__ == "__main__":
    unittest.main()
