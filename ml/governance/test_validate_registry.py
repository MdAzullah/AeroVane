import copy
import json
import unittest
from pathlib import Path

from validate_registry import validate

REGISTRY = Path(__file__).resolve().parents[1] / "manifests" / "dataset_registry.json"
TAXONOMY = Path(__file__).resolve().parents[1] / "configs" / "taxonomy.json"


class RegistryValidationTests(unittest.TestCase):
    def setUp(self):
        self.registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))

    def test_repository_registry_is_valid(self):
        self.assertEqual(validate(self.registry, self.taxonomy), [])

    def test_approved_source_requires_every_check(self):
        changed = copy.deepcopy(self.registry)
        source = changed["sources"][0]
        source["decision"] = "approved"
        source["allowed_uses"] = ["training"]
        errors = validate(changed)
        self.assertTrue(any("incomplete checks" in error for error in errors))

    def test_nonapproved_source_cannot_allow_training(self):
        changed = copy.deepcopy(self.registry)
        changed["sources"][0]["allowed_uses"] = ["training"]
        errors = validate(changed)
        self.assertTrue(any("non-approved source permits payload use" in error for error in errors))

    def test_license_audit_evidence_is_required(self):
        changed = copy.deepcopy(self.registry)
        changed["sources"][0]["license_audit"]["evidence"] = []
        errors = validate(changed)
        self.assertTrue(any("license audit evidence" in error for error in errors))

    def test_registry_family_must_exist_in_frozen_taxonomy(self):
        changed = copy.deepcopy(self.registry)
        changed["sources"][0]["vehicle_families"] = ["flying_car"]
        errors = validate(changed, self.taxonomy)
        self.assertTrue(any("unknown vehicle family" in error for error in errors))

    def test_product_claim_prohibits_vehicle_control(self):
        prohibited = self.taxonomy["product_claim"]["prohibited"]
        self.assertIn("vehicle_control", prohibited)
        self.assertIn("replacement_of_deterministic_rules", prohibited)

    def test_rule_labels_cannot_be_ground_truth(self):
        self.assertFalse(self.taxonomy["cause_assignment"]["weak_rule_labels_are_ground_truth"])


if __name__ == "__main__":
    unittest.main()
