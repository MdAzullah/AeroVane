import unittest

from train_real_anomaly_model import choose_threshold, confusion, fit_preprocessing


class RealModelTests(unittest.TestCase):
    def test_preprocessing_uses_rows_and_imputes_with_median(self):
        rows = [{"x": [1.0]}, {"x": [None]}, {"x": [3.0]}]
        medians, means, scales = fit_preprocessing(rows, 1)
        self.assertEqual(medians, [2.0])
        self.assertEqual(means, [2.0])
        self.assertGreater(scales[0], 0)

    def test_confusion_metrics(self):
        rows = [{"y": 0}, {"y": 0}, {"y": 1}, {"y": 1}]
        result = confusion(rows, [0.1, 0.8, 0.7, 0.2], 0.5)
        self.assertEqual((result["tp"], result["tn"], result["fp"], result["fn"]), (1, 1, 1, 1))

    def test_threshold_is_selected_only_from_supplied_rows(self):
        rows = [{"y": 0}, {"y": 0}, {"y": 1}, {"y": 1}]
        threshold, result = choose_threshold(rows, [0.1, 0.2, 0.8, 0.9])
        self.assertTrue(0.2 < threshold <= 0.8)
        self.assertEqual(result["f1"], 1.0)


if __name__ == "__main__":
    unittest.main()
