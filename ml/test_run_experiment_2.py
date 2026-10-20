import unittest

from run_experiment_2 import persisted, verify_fresh_cohort


class Experiment2Tests(unittest.TestCase):
    def test_rejects_development_hash_overlap(self):
        dev = [{"sha256": "same", "group_id": "dev"}]
        fresh = [{"sha256": "same", "group_id": "fresh", "label": "normal"}]
        with self.assertRaisesRegex(ValueError, "hashes overlap"):
            verify_fresh_cohort(dev, fresh, 1)

    def test_rejects_development_group_overlap(self):
        dev = [{"sha256": "dev", "group_id": "same"}]
        fresh = [{"sha256": "fresh", "group_id": "same", "label": "normal"}]
        with self.assertRaisesRegex(ValueError, "groups overlap"):
            verify_fresh_cohort(dev, fresh, 1)

    def test_persistence_never_crosses_flights(self):
        rows = [
            {"flight_id": "a", "start_ms": 0}, {"flight_id": "a", "start_ms": 1},
            {"flight_id": "b", "start_ms": 0}, {"flight_id": "b", "start_ms": 1},
        ]
        self.assertEqual(persisted([0.9, 0.9, 0.9, 0.1], rows, 2), [0.0, 1.0, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
