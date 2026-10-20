import json
import math
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ulog_adapter import normalize_datasets, route_mav_type
from fixtures.generate_minimal_ulog import write_minimal_ulog


@dataclass
class FakeDataset:
    name: str
    data: dict[str, list[Any]]
    multi_id: int = 0


class ULogAdapterTests(unittest.TestCase):
    def test_source_tool_comparison_fixture(self):
        fixture_path = Path(__file__).with_name("fixtures") / "px4_topic_comparison.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        for case in fixture["cases"]:
            columns = {key: [value] for key, value in case["source"].items()}
            sample = normalize_datasets([FakeDataset(case["topic"], columns)], include_location=True)[0]
            for signal, expected in case["expected"].items():
                self.assertAlmostEqual(sample["values"][signal], expected, places=7)

    def test_routes_frozen_vehicle_families(self):
        self.assertEqual(route_mav_type(2), "multicopter")
        self.assertEqual(route_mav_type(1), "fixed_wing")
        self.assertEqual(route_mav_type(20), "vtol_hybrid")
        self.assertEqual(route_mav_type(10), "ground_rover")
        self.assertEqual(route_mav_type(11), "surface_vessel")
        self.assertEqual(route_mav_type(12), "submersible")
        self.assertEqual(route_mav_type(6), "unknown")

    def test_normalizes_and_stably_sorts_topics(self):
        datasets = [
            FakeDataset("battery_status", {
                "timestamp": [2_000_000], "voltage_v": [15.2],
                "current_a": [2.5], "remaining": [0.75], "temperature": [31.0],
            }),
            FakeDataset("vehicle_status", {
                "timestamp": [1_000_000], "arming_state": [2], "nav_state": [3],
                "vehicle_type": [2], "failsafe": [0],
            }),
        ]
        samples = normalize_datasets(datasets, {"MAV_TYPE": 2, "MAV_SYS_ID": 42})
        self.assertEqual([sample["timestampMs"] for sample in samples], [1000.0, 2000.0])
        self.assertEqual(samples[0]["vehicle"]["family"], "multicopter")
        self.assertEqual(samples[0]["vehicleId"], "42:1")
        self.assertEqual(samples[1]["values"]["battery.remaining_pct"], 75.0)

    def test_same_decoded_flight_is_deterministic(self):
        datasets = [
            FakeDataset("vehicle_status", {
                "timestamp": [1000], "arming_state": [2], "nav_state": [3],
                "vehicle_type": [2], "failsafe": [0],
            }),
            FakeDataset("battery_status", {
                "timestamp": [2000], "voltage_v": [15.2], "current_a": [2.5],
                "remaining": [0.75], "temperature": [31],
            }),
        ]
        parameters = {"MAV_TYPE": 2, "MAV_SYS_ID": 42, "SYS_AUTOSTART": 4001}
        first = normalize_datasets(datasets, parameters)
        second = normalize_datasets(datasets, parameters)
        self.assertEqual(first, second)

    def test_retains_source_airframe_parameters_without_family_guessing(self):
        dataset = FakeDataset("battery_status", {
            "timestamp": [1], "voltage_v": [15], "current_a": [1],
            "remaining": [1], "temperature": [20],
        })
        sample = normalize_datasets([dataset], {
            "MAV_TYPE": 0, "SYS_AUTOSTART": 4001, "CA_AIRFRAME": 2,
        })[0]
        self.assertEqual(sample["frame"], {"airframeId": 4001, "allocatorAirframe": 2})
        self.assertEqual(sample["vehicle"]["family"], "unknown")

    def test_missing_values_are_not_zero_filled(self):
        dataset = FakeDataset("battery_status", {
            "timestamp": [10], "voltage_v": [math.nan], "current_a": [None],
            "remaining": [0.5], "temperature": [25],
        })
        sample = normalize_datasets([dataset])[0]
        self.assertNotIn("battery.voltage_v", sample["values"])
        self.assertFalse(sample["availability"]["battery.voltage_v"])
        self.assertEqual(sample["qualityFlags"]["battery.voltage_v"], ["missing_or_invalid"])

    def test_location_is_private_by_default_and_opt_in(self):
        dataset = FakeDataset("vehicle_gps_position", {
            "timestamp": [1000], "fix_type": [3], "satellites_used": [12],
            "lat": [340_522_000], "lon": [-1_182_437_000], "alt": [12_345],
            "vel_m_s": [4.5],
        })
        private = normalize_datasets([dataset])[0]
        self.assertNotIn("gps.latitude_deg", private["values"])
        retained = normalize_datasets([dataset], include_location=True)[0]
        self.assertAlmostEqual(retained["values"]["gps.latitude_deg"], 34.0522)
        self.assertAlmostEqual(retained["values"]["gps.longitude_deg"], -118.2437)

    def test_unsupported_topics_and_invalid_timestamps_are_skipped(self):
        datasets = [
            FakeDataset("camera_trigger", {"timestamp": [1], "seq": [1]}),
            FakeDataset("battery_status", {"timestamp": [math.nan]}),
        ]
        self.assertEqual(normalize_datasets(datasets), [])


class ULogParserIntegrationTests(unittest.TestCase):
    def test_real_pyulog_parser_boundary(self):
        try:
            from pyulog import ULog
        except ImportError:
            self.skipTest("install ml/requirements.txt to exercise the real parser boundary")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.ulg"
            write_minimal_ulog(path)
            parsed = ULog(str(path), ["battery_status"])
            samples = normalize_datasets(parsed.data_list, parsed.initial_parameters)
        self.assertFalse(parsed.file_corruption)
        self.assertEqual(len(samples), 2)
        self.assertEqual([sample["timestampMs"] for sample in samples], [1000.0, 2000.0])
        self.assertAlmostEqual(samples[0]["values"]["battery.voltage_v"], 15.2, places=5)
        self.assertEqual(samples[1]["values"]["battery.remaining_pct"], 50.0)

    def test_converts_source_quaternion_to_canonical_radians(self):
        half_angle = math.pi / 8
        dataset = FakeDataset("vehicle_attitude", {
            "timestamp": [1000],
            "q[0]": [math.cos(half_angle)], "q[1]": [math.sin(half_angle)],
            "q[2]": [0], "q[3]": [0],
        })
        sample = normalize_datasets([dataset])[0]
        self.assertAlmostEqual(sample["values"]["attitude.roll_rad"], math.pi / 4)
        self.assertAlmostEqual(sample["values"]["attitude.pitch_rad"], 0)
        self.assertAlmostEqual(sample["values"]["attitude.yaw_rad"], 0)
        self.assertEqual(sample["units"]["attitude.roll_rad"], "rad")

    def test_invalid_quaternion_remains_unavailable(self):
        dataset = FakeDataset("vehicle_attitude", {
            "timestamp": [1000], "q[0]": [0], "q[1]": [0], "q[2]": [0], "q[3]": [0],
        })
        sample = normalize_datasets([dataset])[0]
        self.assertNotIn("attitude.roll_rad", sample["values"])
        self.assertFalse(sample["availability"]["attitude.roll_rad"])
        self.assertEqual(sample["qualityFlags"]["attitude.roll_rad"], ["out_of_range"])

    def test_infers_phase_chronologically_across_topics(self):
        datasets = [
            FakeDataset("vehicle_status", {
                "timestamp": [1000, 2000], "arming_state": [1, 2], "nav_state": [0, 0],
                "vehicle_type": [2, 2], "failsafe": [0, 0],
            }),
            FakeDataset("vehicle_land_detected", {
                "timestamp": [1500, 3000, 4000], "landed": [1, 0, 1],
                "ground_contact": [1, 0, 1], "maybe_landed": [1, 0, 1],
            }),
        ]
        samples = normalize_datasets(datasets)
        self.assertEqual(
            [sample["flightPhase"] for sample in samples],
            ["unknown", "on_ground", "armed", "flying", "landed"],
        )


if __name__ == "__main__":
    unittest.main()
