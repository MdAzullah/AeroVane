import copy
import json
import unittest
from pathlib import Path

from validate_splits import validate

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    return json.loads((ROOT / "manifests" / name).read_text(encoding="utf-8"))


class SplitValidationTests(unittest.TestCase):
    def setUp(self):
        self.groups = load("uav-sead-774a336a-pilot-groups.json")
        self.splits = load("uav-sead-774a336a-pilot-splits.json")
        self.inventory = load("uav-sead-774a336a-pilot-inventory.json")
        self.labels = load("uav-sead-774a336a-pilot-labels.json")
        self.registry = load("dataset_registry.json")

    def errors(self, groups=None, splits=None, labels=None, registry=None):
        return validate(groups or self.groups, splits or self.splits, self.inventory, labels or self.labels, registry or self.registry)

    def test_repository_manifests_are_valid(self):
        self.assertEqual(self.errors(), [])

    def test_group_cannot_cross_splits(self):
        changed = copy.deepcopy(self.splits)
        changed["records"][0]["split"] = "train"
        changed["records"][0]["reason"] = None
        errors = self.errors(splits=changed)
        self.assertTrue(any("collection group crosses splits" in error for error in errors))

    def test_quarantined_source_cannot_enter_training(self):
        changed_groups = copy.deepcopy(self.groups)
        changed_splits = copy.deepcopy(self.splits)
        changed_groups["records"][0]["group_id"] = "grp-isolated-test"
        changed_splits["records"][0].update({"group_id": "grp-isolated-test", "split": "train", "reason": None})
        errors = self.errors(groups=changed_groups, splits=changed_splits)
        self.assertTrue(any("non-approved source assigned" in error for error in errors))

    def test_unknown_label_must_be_excluded(self):
        changed_groups = copy.deepcopy(self.groups)
        changed_splits = copy.deepcopy(self.splits)
        changed_registry = copy.deepcopy(self.registry)
        changed_registry["sources"][0]["decision"] = "approved"
        record = changed_splits["records"][-1]
        changed_groups["records"][-1]["group_id"] = "grp-unknown-test"
        record.update({"group_id": "grp-unknown-test", "split": "test", "reason": None})
        errors = self.errors(groups=changed_groups, splits=changed_splits, registry=changed_registry)
        self.assertTrue(any("unknown label must be excluded" in error for error in errors))

    def test_hash_sets_must_match_inventory(self):
        changed = copy.deepcopy(self.splits)
        changed["records"].pop()
        self.assertTrue(any("hashes must exactly match inventory" in error for error in self.errors(splits=changed)))

    def test_duplicate_hash_is_rejected(self):
        changed = copy.deepcopy(self.groups)
        changed["records"].append(copy.deepcopy(changed["records"][0]))
        self.assertTrue(any("duplicate sha256" in error for error in self.errors(groups=changed)))


if __name__ == "__main__":
    unittest.main()
