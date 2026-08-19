"""Evidence storage layout: one document per evaluation, with the per-row
layout still readable until `scripts/compact_blob_documents.py` has run.
"""

import uuid

from app.models.evaluation import Evidence
from app.storage.ids import new_sortable_id


def _evidence(evaluation_id, skill: str) -> Evidence:
    return Evidence(evaluation_id=evaluation_id, skill_name=skill, source_section="Skills")


def test_evidence_for_an_evaluation_is_a_single_document(store):
    evaluation_id = uuid.uuid4()
    store.evidence.save_many([_evidence(evaluation_id, "Python"), _evidence(evaluation_id, "SQL")])

    assert store.evidence._store.list_prefix("evidence") == [f"evidence/{evaluation_id}.json"]


def test_save_many_appends_to_existing_rows(store):
    evaluation_id = uuid.uuid4()
    store.evidence.save_many([_evidence(evaluation_id, "Python")])
    store.evidence.save_many([_evidence(evaluation_id, "SQL")])

    assert [e.skill_name for e in store.evidence.list_for_evaluation(evaluation_id)] == [
        "Python",
        "SQL",
    ]


def test_replace_overwrites_rather_than_appending(store):
    evaluation_id = uuid.uuid4()
    store.evidence.save_many([_evidence(evaluation_id, "stale")])
    store.evidence.replace_for_evaluations({str(evaluation_id): [_evidence(evaluation_id, "fresh")]})

    assert [e.skill_name for e in store.evidence.list_for_evaluation(evaluation_id)] == ["fresh"]


def test_evidence_of_one_evaluation_does_not_leak_into_another(store):
    first, second = uuid.uuid4(), uuid.uuid4()
    store.evidence.replace_for_evaluations(
        {str(first): [_evidence(first, "Python")], str(second): [_evidence(second, "Go")]}
    )

    assert [e.skill_name for e in store.evidence.list_for_evaluation(first)] == ["Python"]
    assert [e.skill_name for e in store.evidence.list_for_evaluation(second)] == ["Go"]


def test_rows_left_in_the_per_row_layout_are_still_read(store):
    evaluation_id = uuid.uuid4()
    store.evidence._store.put(
        f"evidence/{evaluation_id}/{new_sortable_id()}.json",
        _evidence(evaluation_id, "legacy skill").model_dump(mode="json"),
    )

    assert [e.skill_name for e in store.evidence.list_for_evaluation(evaluation_id)] == [
        "legacy skill"
    ]


def test_consolidated_document_takes_precedence_over_legacy_rows(store):
    evaluation_id = uuid.uuid4()
    store.evidence._store.put(
        f"evidence/{evaluation_id}/{new_sortable_id()}.json",
        _evidence(evaluation_id, "legacy").model_dump(mode="json"),
    )
    store.evidence.replace_for_evaluations({str(evaluation_id): [_evidence(evaluation_id, "current")]})

    assert [e.skill_name for e in store.evidence.list_for_evaluation(evaluation_id)] == ["current"]


def test_delete_removes_both_layouts(store):
    evaluation_id = uuid.uuid4()
    store.evidence._store.put(
        f"evidence/{evaluation_id}/{new_sortable_id()}.json",
        _evidence(evaluation_id, "legacy").model_dump(mode="json"),
    )
    store.evidence.save_many([_evidence(evaluation_id, "current")])

    store.evidence.delete_for_evaluation(evaluation_id)
    assert store.evidence.list_for_evaluation(evaluation_id) == []


def test_rescoring_replaces_evidence_instead_of_accumulating(store, sample_candidate, sample_job):
    """Re-ranking used to delete rows then rewrite them; now it overwrites."""
    import asyncio

    from app.services.candidate_matcher import CandidateMatcher

    matcher = CandidateMatcher()
    asyncio.run(matcher.rank_candidates(store, sample_job.id, persist=True))
    first = store.evaluations.list_for_job(sample_job.id)[0]
    count_after_first = len(store.evidence.list_for_evaluation(first.id))

    asyncio.run(matcher.rank_candidates(store, sample_job.id, persist=True))
    assert len(store.evidence.list_for_evaluation(first.id)) == count_after_first


# ---------- candidate history: partitioned by candidate ----------


from app.models.handoff import CandidateHistoryEvent  # noqa: E402
from app.services import handoff_service  # noqa: E402


def _event(candidate_id: str, summary: str, job_id: str | None = None) -> CandidateHistoryEvent:
    return CandidateHistoryEvent(
        candidate_id=candidate_id,
        event_type="evaluation_created",
        job_id=job_id,
        summary=summary,
        details={},
    )


def test_history_is_written_under_its_candidate_partition(store):
    candidate_id = str(uuid.uuid4())
    store.candidate_history_events.save(_event(candidate_id, "scored"))

    keys = store.candidate_history_events._store.list_prefix("candidate_history_events")
    assert all(key.startswith(f"candidate_history_events/{candidate_id}/") for key in keys)


def test_history_read_only_touches_the_candidates_own_partition(store):
    wanted, other = str(uuid.uuid4()), str(uuid.uuid4())
    store.candidate_history_events.save_many(
        [_event(wanted, "mine-1"), _event(other, "theirs"), _event(wanted, "mine-2")]
    )

    events = store.candidate_history_events.list_for_candidate(wanted)
    assert {e.summary for e in events} == {"mine-1", "mine-2"}


def test_get_history_filters_by_job(store):
    candidate_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    store.candidate_history_events.save_many(
        [
            _event(candidate_id, "this job", job_id),
            _event(candidate_id, "other job", str(uuid.uuid4())),
        ]
    )

    assert [e.summary for e in handoff_service.get_history(store, candidate_id, job_id)] == [
        "this job"
    ]


def test_history_still_reads_documents_left_in_the_flat_layout(store):
    """Deployments that have not run the migration must not lose history."""
    candidate_id = str(uuid.uuid4())
    store.candidate_history_events._store.put(
        f"candidate_history_events/{new_sortable_id()}.json",
        _event(candidate_id, "written before partitioning").model_dump(mode="json"),
    )

    assert [e.summary for e in store.candidate_history_events.list_for_candidate(candidate_id)] == [
        "written before partitioning"
    ]


def test_partitioned_and_flat_events_are_merged_not_preferred(store):
    """A partition holding some events says nothing about whether older ones
    are still flat — preferring one layout silently loses history."""
    candidate_id = str(uuid.uuid4())
    store.candidate_history_events._store.put(
        f"candidate_history_events/{new_sortable_id()}.json",
        _event(candidate_id, "older, still flat").model_dump(mode="json"),
    )
    store.candidate_history_events.save(_event(candidate_id, "newer, partitioned"))

    summaries = {e.summary for e in store.candidate_history_events.list_for_candidate(candidate_id)}
    assert summaries == {"older, still flat", "newer, partitioned"}


def test_an_event_present_in_both_layouts_is_returned_once(store):
    """Mid-migration a document can exist in both places; it is one event."""
    candidate_id = str(uuid.uuid4())
    doc = _event(candidate_id, "copied but not yet cleaned up").model_dump(mode="json")
    store.candidate_history_events._store.put(
        f"candidate_history_events/{new_sortable_id()}.json", doc
    )
    store.candidate_history_events._store.put(
        f"candidate_history_events/{candidate_id}/{new_sortable_id()}.json", doc
    )

    assert len(store.candidate_history_events.list_for_candidate(candidate_id)) == 1


def test_legacy_scan_is_skipped_once_migration_marker_is_written(store):
    candidate_id = str(uuid.uuid4())
    store.candidate_history_events._store.put(
        f"candidate_history_events/{new_sortable_id()}.json",
        _event(candidate_id, "stale flat copy").model_dump(mode="json"),
    )
    store.candidate_history_events.mark_partitioned()

    assert store.candidate_history_events.list_for_candidate(candidate_id) == []


def test_marker_is_not_returned_as_a_history_event(store):
    store.candidate_history_events.mark_partitioned()
    assert store.candidate_history_events.list_all() == []
