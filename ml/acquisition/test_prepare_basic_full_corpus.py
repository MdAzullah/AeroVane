import unittest

from prepare_basic_full_corpus import records


class BasicCorpusTests(unittest.TestCase):
    def test_groups_complete_location_cohorts(self):
        classes = ["No Failure", "RC Failure", "GPS Failure", "Accelerometer Failure", "Gyro Failure", "Compass Failure", "Barometer Failure"]
        files = []
        for group in range(10):
            for offset, label in enumerate(classes):
                files.append({"key": f"2022-08-{group + 1:02d} 00-00-{offset:02d} ({label}).log",
                              "size": 1, "checksum": "md5:abc", "links": {"content": "https://example.invalid"}})
        result = records({"files": files})
        self.assertEqual(len(result), 70)
        self.assertEqual(len({item["group_id"] for item in result}), 10)
        self.assertEqual(len({item["class"] for item in result[:7]}), 7)

    def test_rejects_incomplete_class_cohort(self):
        files = [{"key": f"2022-08-{index // 7 + 1:02d} 00-00-{index % 7:02d} (No Failure).log",
                  "size": 1, "checksum": "md5:abc", "links": {"content": "x"}} for index in range(70)]
        with self.assertRaises(SystemExit):
            records({"files": files})


if __name__ == "__main__":
    unittest.main()
