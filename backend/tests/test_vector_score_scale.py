"""Both vector backends must report scores on the same scale.

Ranking is unaffected by Azure's transform (it is monotonic), so an
ordering-only test passes either way. What differs is the magnitude, and that
number reaches the recruiter as a "% fit" and is what `min_score` is compared
against — so it is the magnitude that needs pinning.
"""

import pytest

from app.services.vector_store import _cosine_from_search_score


@pytest.mark.parametrize(
    "cosine",
    [-1.0, -0.25, 0.0, 0.3436, 0.4969, 0.5385, 0.5529, 0.9, 1.0],
)
def test_round_trips_azures_cosine_transform(cosine):
    """Azure reports 1/(2 - cosine) for a cosine profile; we must invert it."""
    azure_score = 1.0 / (2.0 - cosine)
    assert _cosine_from_search_score(azure_score) == pytest.approx(cosine, abs=1e-9)


def test_orthogonal_vectors_do_not_read_as_a_half_decent_match():
    """The regression this guards: cosine 0 arrives from Azure as 0.5.

    Rendered as "% fit" that is a 50% match for a candidate with nothing in
    common with the query.
    """
    assert _cosine_from_search_score(0.5) == pytest.approx(0.0, abs=1e-9)


def test_azure_score_floor_maps_to_the_cosine_floor():
    """Azure's minimum (0.333) is cosine -1, not "a third of a match"."""
    assert _cosine_from_search_score(1.0 / 3.0) == pytest.approx(-1.0, abs=1e-9)


def test_zero_score_does_not_divide_by_zero():
    assert _cosine_from_search_score(0.0) == 0.0
