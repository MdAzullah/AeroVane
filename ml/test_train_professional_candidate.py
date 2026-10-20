import unittest

from train_professional_candidate import choose_threshold, metrics


class ProfessionalCandidateTests(unittest.TestCase):
    def test_metrics(self):
        result = metrics([0, 0, 1, 1], [0.1, 0.9, 0.8, 0.2], 0.5)
        self.assertEqual((result["tp"], result["tn"], result["fp"], result["fn"]), (1, 1, 1, 1))

    def test_threshold_respects_gate_when_feasible(self):
        threshold, result = choose_threshold([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9], {"recall_min": 0.65, "false_warning_rate_max": 0.15})
        self.assertGreater(threshold, 0.2)
        self.assertEqual(result["f1"], 1.0)


if __name__ == "__main__": unittest.main()
