import copy
import json
import unittest
from pathlib import Path

from validate_pilot_authorization import validate_authorization, validate_proposal_binding

ML_ROOT = Path(__file__).resolve().parents[1]


class PilotAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.registry = json.loads((ML_ROOT / "manifests" / "dataset_registry.json").read_text(encoding="utf-8"))
        self.authorization = {
            "schema_version": "1.0.0",
            "source_id": "uav-sead",
            "source_version": "commit-0123456789abcdef",
            "authorized_at": "2026-09-25T00:00:00Z",
            "authorized_by": "project-owner",
            "purpose": "phase_c_parser_and_inventory_pilot",
            "limits": {"maximum_flights": 5, "maximum_download_bytes": 1_000_000_000, "bulk_download_allowed": False},
            "registry_checks": {"license_reviewed": True, "provenance_reviewed": True, "privacy_plan_reviewed": True},
            "status": "authorized",
        }

    def eligible_registry(self):
        registry = copy.deepcopy(self.registry)
        source = next(item for item in registry["sources"] if item["id"] == "uav-sead")
        source["checks"].update({"license": True, "provenance": True, "privacy": True})
        return registry

    def test_allows_bounded_pilot_after_prechecks(self):
        self.assertEqual(validate_authorization(self.authorization, self.eligible_registry()), [])

    def test_incomplete_quarantined_source_fails_prechecks(self):
        authorization = copy.deepcopy(self.authorization)
        authorization["source_id"] = "alfa"
        errors = validate_authorization(authorization, self.registry)
        self.assertTrue(any("license" in error for error in errors))
        self.assertTrue(any("provenance" in error for error in errors))
        self.assertTrue(any("privacy" in error for error in errors))

    def test_rejects_bulk_or_excessive_pilot(self):
        authorization = copy.deepcopy(self.authorization)
        authorization["limits"] = {"maximum_flights": 6, "maximum_download_bytes": 2 * 1024**3, "bulk_download_allowed": True}
        errors = validate_authorization(authorization, self.eligible_registry())
        self.assertTrue(any("maximum_flights" in error for error in errors))
        self.assertTrue(any("maximum_download_bytes" in error for error in errors))
        self.assertTrue(any("bulk_download_allowed" in error for error in errors))

    def test_rejected_or_noncommercial_source_cannot_be_authorized(self):
        authorization = copy.deepcopy(self.authorization)
        authorization["source_id"] = "rflymad"
        registry = copy.deepcopy(self.registry)
        source = next(item for item in registry["sources"] if item["id"] == "rflymad")
        source["checks"].update({"license": True, "provenance": True, "privacy": True})
        errors = validate_authorization(authorization, registry)
        self.assertTrue(any("rejected" in error for error in errors))
        self.assertTrue(any("commercially compatible" in error for error in errors))

    def test_requires_immutable_nonplaceholder_version(self):
        authorization = copy.deepcopy(self.authorization)
        authorization["source_version"] = "immutable-version-required"
        self.assertTrue(any("immutable" in error for error in validate_authorization(authorization, self.eligible_registry())))

    def test_proposal_binding_checks_identity_count_and_limits(self):
        proposal = {
            "status": "proposal_only", "download_authorized": False,
            "source_id": "uav-sead", "source_version": "commit-0123456789abcdef",
            "records": [{"candidate_id": "candidate-001"}],
            "summary": {"total_bytes": 100},
        }
        encoded = json.dumps(proposal).encode()
        import hashlib
        authorization = copy.deepcopy(self.authorization)
        authorization["proposal"] = {"sha256": hashlib.sha256(encoded).hexdigest(), "candidate_count": 1, "path": "proposal.json"}
        self.assertEqual(validate_proposal_binding(authorization, proposal, encoded), [])

    def test_changed_proposal_breaks_binding(self):
        proposal = {"status": "proposal_only", "download_authorized": False, "source_id": "uav-sead", "source_version": "commit-0123456789abcdef", "records": [], "summary": {"total_bytes": 0}}
        authorization = copy.deepcopy(self.authorization)
        authorization["proposal"] = {"sha256": "0" * 64, "candidate_count": 1, "path": "proposal.json"}
        errors = validate_proposal_binding(authorization, proposal, json.dumps(proposal).encode())
        self.assertTrue(any("SHA-256" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
