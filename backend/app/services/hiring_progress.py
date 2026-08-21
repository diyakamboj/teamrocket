"""What has happened to each candidate on a job, and what to do next.

The job workspace showed a stage name and a set of buttons, and left the
recruiter to work out which button was appropriate. That is fine if you
already know the process; it is not if you do not, and "a non-technical
recruiter should be able to run this" is the whole premise of the product.

So the next action is computed here rather than inferred in the interface:
one place, one rule, and the board cannot drift from it.

Each candidate gets a checklist of the same steps in the same order, so a
row can be read across rather than interpreted:

    screened -> assessment -> interview rounds -> decision

An assessment step is deliberately three-valued. "Not started" and
"skipped" look identical on a board that only records completion, and the
difference between "nobody has looked at this" and "we decided this person
does not need one" is exactly what an inexperienced recruiter cannot
reconstruct later.
"""

from __future__ import annotations

from typing import Any, Optional

from app.models.job_posting import JobPosting
from app.storage.store import Store

__all__ = ["candidate_progress_for_job", "StepState"]

#: A step is one of these. `blocked` is not used yet but keeps the vocabulary
#: closed so the interface can switch on it exhaustively.
StepState = str  # "done" | "current" | "todo" | "skipped"


def _assessment_for(store: Store, candidate_id: str, job_id: str):
    """The most recent assessment for this candidate on this job.

    Falls back to an assessment with no job attached: readiness assessments
    predate being job-scoped, and an existing one should still count rather
    than prompting the recruiter to send a second.
    """
    rows = store.readiness_assessments.query(
        lambda r: str(r.candidate_id) == str(candidate_id)
    )
    if not rows:
        return None
    scoped = [r for r in rows if str(r.job_id or "") == str(job_id)]
    unscoped = [r for r in rows if not r.job_id]
    pool = scoped or unscoped
    if not pool:
        return None
    return sorted(pool, key=lambda r: r.updated_at or r.created_at)[-1]


def _assessment_step(record) -> dict[str, Any]:
    if record is None:
        return {
            "key": "assessment",
            "label": "Skills assessment",
            "state": "todo",
            "detail": "Not sent yet",
            "hint": "Send one to check the skills the résumé claims, or skip it if you already know.",
        }
    if record.status == "skipped":
        return {
            "key": "assessment",
            "label": "Skills assessment",
            "state": "skipped",
            "detail": record.skip_reason or "Skipped by the recruiter",
            "hint": "Deliberately skipped — no action needed.",
        }
    if record.status in ("completed", "reviewed"):
        score = record.score
        return {
            "key": "assessment",
            "label": "Skills assessment",
            "state": "done",
            "detail": f"Scored {score:g}" if score is not None else "Completed",
            "hint": "",
        }
    if record.status in ("sent", "in_progress"):
        return {
            "key": "assessment",
            "label": "Skills assessment",
            "state": "current",
            "detail": "Sent — waiting on the candidate",
            "hint": "Nothing to do until they submit it.",
        }
    return {
        "key": "assessment",
        "label": "Skills assessment",
        "state": "todo",
        "detail": "Recommended, not sent",
        "hint": "Send it, or skip it if you already know their level.",
    }


def candidate_progress_for_job(
    store: Store, job: JobPosting, pipeline_rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """One checklist per candidate, plus the single next thing to do."""
    rounds = sorted(job.rounds or [], key=lambda r: r.sequence)
    results: list[dict[str, Any]] = []

    for row in pipeline_rows:
        candidate_id = str(row.get("candidate_id"))
        stage = row.get("stage") or "screened"
        candidate = store.candidates.get(candidate_id)
        hired = bool(candidate and candidate.hiring_status == "hired")
        rejected = bool(candidate and candidate.hiring_status == "rejected")

        assessment = _assessment_for(store, candidate_id, str(job.id))
        steps: list[dict[str, Any]] = [
            {
                "key": "screened",
                "label": "Résumé reviewed",
                "state": "done",
                "detail": (
                    f"ATS score {row['overall_score']:.0f}"
                    if row.get("overall_score") is not None
                    else "Scored"
                ),
                "hint": "",
            },
            _assessment_step(assessment),
        ]

        # Interview rounds, in the order this job actually runs them.
        current_sequence = row.get("round_sequence")
        for interview_round in rounds:
            if hired or stage in ("selected", "hired"):
                state = "done"
            elif rejected or stage == "rejected":
                state = "todo"
            elif stage in ("interviewing", "interviewed") and current_sequence:
                if interview_round.sequence < current_sequence:
                    state = "done"
                elif interview_round.sequence == current_sequence:
                    state = "current"
                else:
                    state = "todo"
            elif stage == "interviewed":
                state = "done"
            else:
                state = "todo"
            steps.append(
                {
                    "key": f"round:{interview_round.id}",
                    "label": interview_round.name,
                    "state": state,
                    "detail": interview_round.focus or interview_round.interview_type,
                    "hint": "",
                    "interviewer": getattr(interview_round, "interviewer_name", None),
                }
            )

        steps.append(
            {
                "key": "decision",
                "label": "Decision",
                "state": "done" if hired or rejected else "todo",
                "detail": "Hired" if hired else ("Not proceeding" if rejected else "No decision yet"),
                "hint": "",
            }
        )

        results.append(
            {
                "candidate_id": candidate_id,
                "candidate_name": row.get("candidate_name"),
                "stage": stage,
                "hiring_status": (candidate.hiring_status if candidate else "active"),
                "steps": steps,
                "next_action": _next_action(steps, hired, rejected),
                "assessment_id": str(assessment.id) if assessment else None,
                "assessment_status": assessment.status if assessment else None,
            }
        )

    return results


def _next_action(
    steps: list[dict[str, Any]], hired: bool, rejected: bool
) -> Optional[dict[str, str]]:
    """The one thing to do next, in plain language.

    Deliberately singular. Offering every possible action at once is what
    made the board unreadable to someone who does not already know the
    process.
    """
    if hired or rejected:
        return None

    for step in steps:
        if step["key"] == "assessment" and step["state"] == "todo":
            return {
                "kind": "send_assessment",
                "label": "Send skills assessment",
                "why": "Checks the skills their résumé claims before you spend interview time.",
                # Done right here — no need to send anyone elsewhere.
                "goto": None,
                "goto_label": None,
            }
        if step["key"] == "assessment" and step["state"] == "current":
            return {
                "kind": "wait",
                "label": "Waiting on the candidate",
                "why": "The assessment is with them. Nothing to do until it comes back.",
                "goto": None,
                "goto_label": None,
            }
        if step["key"].startswith("round:") and step["state"] in ("todo", "current"):
            return {
                "kind": "advance",
                "label": f"Move to {step['label']}",
                "why": "Everything before this round is done. Moving people between rounds happens on the board.",
                # The checklist says what to do; the board is where it is
                # done. Without this link a recruiter reads "move to the
                # technical interview" and has no idea where to go.
                "goto": "pipeline",
                "goto_label": "Go to the board",
            }

    return {
        "kind": "decide",
        "label": "Make a decision",
        "why": "All rounds are complete — hire them or let them go.",
        "goto": "candidates",
        "goto_label": "Go to the candidate list",
    }
