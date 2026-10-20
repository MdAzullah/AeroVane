import unittest
import numpy as np

from train_basic_sensor_classifier import macro_f1, split_rows


class BasicTrainingTests(unittest.TestCase):
    def test_split_is_group_exact_and_excludes_unknown(self):
        config = {"classes":["normal"], "splits":{"train_groups":["a"], "validation_groups":["b"], "test_groups":["c"]}}
        rows = [{"group_id":"a", "label":"normal", "eligible":True}, {"group_id":"b", "label":"unknown", "eligible":False}, {"group_id":"c", "label":"normal", "eligible":True}]
        result = split_rows(rows, config)
        self.assertEqual([len(result[key]) for key in ("train", "validation", "test")], [1, 0, 1])

    def test_macro_f1_penalizes_missing_class(self):
        self.assertAlmostEqual(macro_f1(np.array([0, 1]), np.array([0, 0]), 2), 1 / 3)


if __name__ == "__main__": unittest.main()
