import tempfile
import unittest
from pathlib import Path

from build_inventory import build_inventory, classify


class InventoryTests(unittest.TestCase):
    def test_classifies_supported_formats_case_insensitively(self):
        self.assertEqual(classify(Path("flight.ULG")), "ulog")
        self.assertEqual(classify(Path("flight.bin")), "dataflash_bin")
        self.assertEqual(classify(Path("flight.tlog")), "tlog")
        self.assertEqual(classify(Path("labels.csv")), "annotation")
        self.assertEqual(classify(Path("payload.exe")), "unknown")

    def test_hashes_sorts_and_deduplicates_without_absolute_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            (root / "b.ulg").write_bytes(b"same")
            (root / "nested" / "a.ulg").write_bytes(b"same")
            (root / "labels.csv").write_text("label\nnormal\n", encoding="utf-8")
            inventory = build_inventory(root, "test-source", "v1", "2026-09-25T00:00:00Z")

        self.assertEqual([entry["relative_path"] for entry in inventory["files"]], ["b.ulg", "labels.csv", "nested/a.ulg"])
        self.assertEqual(inventory["files"][2]["duplicate_of"], "b.ulg")
        self.assertEqual(inventory["summary"]["file_count"], 3)
        self.assertEqual(inventory["summary"]["unique_file_count"], 2)
        self.assertEqual(inventory["summary"]["duplicate_count"], 1)
        self.assertNotIn(directory, str(inventory))

    def test_is_deterministic_for_fixed_inputs_and_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "flight.bin").write_bytes(b"fixture")
            first = build_inventory(root, "fixture", "1", "2026-09-25T00:00:00Z")
            second = build_inventory(root, "fixture", "1", "2026-09-25T00:00:00Z")
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
