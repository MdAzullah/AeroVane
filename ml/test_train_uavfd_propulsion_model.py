import numpy as np

from train_uavfd_propulsion_model import partition, scores


def test_fixed_motor_split_is_group_disjoint():
    assert partition("NO_FAULT1.mat") == "train"
    assert partition("FAULT_M4_10.mat") == "train"
    assert partition("FAULT_M5_5.mat") == "validation"
    assert partition("FAULT_M6_10.mat") == "test"


def test_persistence_resets_at_flight_boundary():
    result = scores(
        np.asarray([0, 0, 0, 0]),
        np.asarray([0.9, 0.9, 0.9, 0.9]),
        flights=["a", "a", "b", "b"],
        persistence=2,
    )
    assert result["fp"] == 2
    assert result["tn"] == 2
