import tempfile
import unittest
from pathlib import Path

from build_basic_windows import build_flight


class BasicWindowTests(unittest.TestCase):
    def test_fault_health_transition_labels_post_onset_only(self):
        text = "\n".join([
            "FMT, 86, 51, GPS, x, TimeUS,I,Status,NSats,HDop,Spd,VZ",
            "GPS, 1000000, 0, 6, 10, 1, 2, 0",
            "GPS, 6000000, 0, 6, 10, 1, 2, 0",
            "GPS, 11000000, 0, 1, 3, 9, 0, 0",
            "GPS, 16000000, 0, 1, 3, 9, 0, 0",
        ])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "flight.log"; path.write_text(text)
            rows, onset = build_flight(path, {"flight_id":"f", "group_id":"g", "class":"gps_failure"}, ["GPS.NSats_mean"])
        self.assertEqual(onset, 11000000)
        self.assertEqual([row["label"] for row in rows], ["normal", "normal", "unknown", "gps_failure"])

    def test_rc_failure_abstains(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "flight.log"
            path.write_text("FMT, 86, 51, GPS, x, TimeUS,I,Status,NSats\nGPS, 1000000, 0, 6, 10\n")
            rows, _ = build_flight(path, {"flight_id":"f", "group_id":"g", "class":"rc_failure"}, ["GPS.NSats_mean"])
        self.assertEqual(rows[0]["label"], "unknown")
        self.assertFalse(rows[0]["eligible"])


if __name__ == "__main__": unittest.main()
