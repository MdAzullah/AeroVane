import io
import stat
import tarfile
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

from inspect_archive import inspect_archive


class ArchiveInspectionTests(unittest.TestCase):
    def test_accepts_small_safe_zip_without_extracting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pilot.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("logs/flight.ulg", b"fixture")
            report = inspect_archive(path)
        self.assertTrue(report["safe_to_extract"])
        self.assertEqual(report["member_count"], 1)

    def test_rejects_traversal_duplicate_and_high_expansion_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.zip"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr("../escape.ulg", b"bad")
                    archive.writestr("same.txt", b"one")
                    archive.writestr("same.txt", b"two")
                    archive.writestr("bomb.txt", b"0" * 100_000)
            report = inspect_archive(path, max_expansion_ratio=10)
        self.assertFalse(report["safe_to_extract"])
        self.assertTrue(any(item.startswith("unsafe_path:") for item in report["findings"]))
        self.assertTrue(any(item.startswith("duplicate_member_path:") for item in report["findings"]))
        self.assertTrue(any(item.startswith("excessive_expansion:") for item in report["findings"]))

    def test_rejects_tar_links_and_absolute_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.tar"
            with tarfile.open(path, "w") as archive:
                payload = b"fixture"
                regular = tarfile.TarInfo("/absolute/flight.ulg")
                regular.size = len(payload)
                archive.addfile(regular, io.BytesIO(payload))
                link = tarfile.TarInfo("logs/link.ulg")
                link.type = tarfile.SYMTYPE
                link.linkname = "../flight.ulg"
                archive.addfile(link)
            report = inspect_archive(path)
        self.assertFalse(report["safe_to_extract"])
        self.assertTrue(any(item.startswith("unsafe_path:") for item in report["findings"]))
        self.assertTrue(any(item.startswith("link_member:") for item in report["findings"]))

    def test_rejects_zip_symlinks_and_unsupported_formats(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            zip_path = root / "link.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                info = zipfile.ZipInfo("logs/link.ulg")
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, "target.ulg")
            unsupported = root / "pilot.7z"
            unsupported.write_bytes(b"not inspected")
            link_report = inspect_archive(zip_path)
            unsupported_report = inspect_archive(unsupported)
        self.assertFalse(link_report["safe_to_extract"])
        self.assertFalse(unsupported_report["safe_to_extract"])
        self.assertIn("unsupported_archive_format", unsupported_report["findings"])


if __name__ == "__main__":
    unittest.main()
