import unittest

from select_candidates import build_outputs, candidates, select
from download_authorized_batch import validate_private_mapping


class CandidateSelectionTests(unittest.TestCase):
    def fixture(self):
        mapping, siblings = {}, []
        for index, label in enumerate(["Altitude", "Mechanical", "External Position", "Normal", "Normal", "Uncategorized"]):
            key = f"day-{index}/flight"
            mapping[key] = {"annotations": [{"class": label, "ranges": [["signal", [[1, 2]]]] if label not in {"Normal", "Uncategorized"} else []}]}
            siblings.append({"rfilename": f"ulg_files/{key}.ulg", "size": 100 + index})
        return mapping, {"siblings": siblings}

    def test_selects_three_ranged_anomalies_and_two_normals(self):
        mapping, index = self.fixture()
        chosen = select(candidates(mapping, index, b"secret", set()))
        self.assertEqual([item["label"] for item in chosen], ["anomalous"] * 3 + ["normal"] * 2)

    def test_uncategorized_and_unranged_anomaly_are_excluded(self):
        mapping, index = self.fixture()
        mapping["day-0/flight"]["annotations"][0]["ranges"] = []
        pool = candidates(mapping, index, b"secret", set())
        self.assertEqual(len(pool), 4)

    def test_prior_locator_is_excluded(self):
        mapping, index = self.fixture()
        pool = candidates(mapping, index, b"secret", {"ulg_files/day-0/flight.ulg"})
        self.assertFalse(any(item["locator"].endswith("day-0/flight.ulg") for item in pool))

    def test_public_output_has_no_source_locator(self):
        mapping, index = self.fixture()
        public, private = build_outputs(select(candidates(mapping, index, b"secret", set())), "source", "rev")
        rendered = str(public)
        self.assertNotIn("ulg_files", rendered)
        self.assertFalse(public["download_authorized"])
        self.assertEqual(len(private["mapping"]), 5)

    def test_size_ceiling_is_enforced(self):
        mapping, index = self.fixture()
        chosen = select(candidates(mapping, index, b"secret", set()), maximum_bytes=203)
        self.assertLessEqual(sum(item["size_bytes"] for item in chosen), 203)

    def test_prefers_groups_not_used_by_prior_cohorts(self):
        mapping, index = self.fixture()
        pool = candidates(mapping, index, b"secret", set())
        first_anomaly_group = next(item["group_id"] for item in pool if item["label"] == "anomalous")
        chosen = select(pool, prior_groups={first_anomaly_group})
        self.assertNotEqual(chosen[0]["group_id"], first_anomaly_group)

    def test_private_mapping_must_exactly_match_proposal(self):
        proposal = {"source_id": "s", "source_version": "v", "records": [{"candidate_id": "candidate-001"}]}
        private = {"source_id": "s", "source_version": "v", "mapping": {"candidate-002": "secret.ulg"}}
        self.assertTrue(validate_private_mapping(proposal, private))


if __name__ == "__main__":
    unittest.main()
