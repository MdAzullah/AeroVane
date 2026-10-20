import json
import unittest
from pathlib import Path

from build_windows import FEATURES, aggregate, build_flight, observations, window_label


class WindowBuilderTests(unittest.TestCase):
    def test_code_features_match_frozen_contract(self):
        config_path = Path(__file__).resolve().parents[1] / "configs" / "window_features.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertEqual(tuple(item["name"] for item in config["features"]), FEATURES)

    def test_private_metadata_is_not_a_feature(self):
        sample = {"values": {"gps.latitude_deg": 1, "gps.longitude_deg": 2, "battery.voltage_v": 12}}
        self.assertEqual(observations(sample), {"battery_voltage_v": 12.0})

    def test_vector_magnitudes_and_aggregation(self):
        features, counts = aggregate([{"values": {"imu.xacc_mps2": 3, "imu.yacc_mps2": 4, "imu.zacc_mps2": 0}}])
        self.assertEqual(features["accel_magnitude_mps2_mean"], 5)
        self.assertEqual(counts["accel_magnitude_mps2_max"], 1)

    def test_missing_features_are_null(self):
        features, counts = aggregate([{"values": {}}])
        self.assertIsNone(features["battery_voltage_v_mean"])
        self.assertEqual(counts["battery_voltage_v_mean"], 0)

    def test_anomaly_overlap_and_boundary_padding(self):
        label = {"window_label": "anomalous", "ranges_ms": [{"start": 10000, "end": 12000}]}
        self.assertEqual(window_label(label, 9000, 11000), "anomalous")
        self.assertEqual(window_label(label, 7000, 8500), "unknown")
        self.assertEqual(window_label(label, 0, 5000), "normal")

    def test_unknown_flight_stays_unknown(self):
        self.assertEqual(window_label({"window_label": "unknown"}, 0, 5000), "unknown")

    def test_windows_are_deterministic_and_keep_split_metadata_outside_features(self):
        samples = [{"timestampMs": 0, "values": {"battery.voltage_v": 12}}, {"timestampMs": 3000, "values": {"battery.voltage_v": 11}}]
        label = {"flight_id": "flight-001", "sha256": "a" * 64, "window_label": "normal", "ranges_ms": []}
        split = {"group_id": "grp-one", "split": "excluded"}
        first = build_flight(samples, label, split)
        self.assertEqual(first, build_flight(samples, label, split))
        self.assertNotIn("split", first[0]["features"])
        self.assertEqual(first[0]["features"]["battery_voltage_v_min"], 11)


if __name__ == "__main__":
    unittest.main()
