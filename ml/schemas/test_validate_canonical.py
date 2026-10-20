import copy
import json
import tempfile
import unittest
from pathlib import Path

from validate_canonical import validate_jsonl, validate_sample


VALID_SAMPLE = {
    "schemaVersion": "1.0.0",
    "timestampMs": 1000.0,
    "source": "ulog",
    "vehicleId": "42:1",
    "vehicle": {"systemId": 42, "componentId": 1, "mavType": 2, "autopilot": 12, "family": "multicopter"},
    "flightPhase": "unknown",
    "values": {"battery.voltage_v": 15.2},
    "units": {"battery.voltage_v": "V"},
    "availability": {"battery.voltage_v": True, "battery.current_a": False},
    "qualityFlags": {"battery.current_a": ["missing_or_invalid"]},
}


class CanonicalValidationTests(unittest.TestCase):
    def test_valid_sample(self):
        self.assertEqual(validate_sample(VALID_SAMPLE), [])

    def test_value_requires_availability_and_unit(self):
        sample = copy.deepcopy(VALID_SAMPLE)
        sample["availability"]["battery.voltage_v"] = False
        sample["units"].clear()
        errors = validate_sample(sample)
        self.assertTrue(any("marked available" in error for error in errors))
        self.assertTrue(any("requires a unit" in error for error in errors))
        self.assertTrue(any("must be absent" in error for error in errors))

    def test_unavailable_signal_requires_reason(self):
        sample = copy.deepcopy(VALID_SAMPLE)
        sample["qualityFlags"].clear()
        self.assertTrue(any("requires a quality flag" in error for error in validate_sample(sample)))

    def test_rejects_nonfinite_numbers_and_unknown_family(self):
        sample = copy.deepcopy(VALID_SAMPLE)
        sample["values"]["battery.voltage_v"] = float("nan")
        sample["vehicle"]["family"] = "flying_car"
        errors = validate_sample(sample)
        self.assertTrue(any("value must be finite" in error for error in errors))
        self.assertTrue(any("family is unsupported" in error for error in errors))

    def test_validates_source_frame_metadata(self):
        sample = copy.deepcopy(VALID_SAMPLE)
        sample["frame"] = {"airframeId": 4001, "allocatorAirframe": 2}
        self.assertEqual(validate_sample(sample), [])
        sample["frame"] = {"guessedFrame": 1}
        self.assertTrue(any("unsupported" in error for error in validate_sample(sample)))

    def test_jsonl_reports_line_numbers_and_nonstandard_nan(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "samples.jsonl"
            path.write_text(json.dumps(VALID_SAMPLE) + "\n" + '{"timestampMs": NaN}\n', encoding="utf-8")
            errors = validate_jsonl(path)
        self.assertTrue(any(error.startswith("line 2: invalid JSON") for error in errors))


if __name__ == "__main__":
    unittest.main()
