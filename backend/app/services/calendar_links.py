"""Outlook "Add to Calendar" deep links — real, free, no Azure app registration.

Uses Microsoft's documented outlook.office.com compose deeplink
(https://outlook.office.com/calendar/deeplink/compose) to let a candidate
add a proposed interview slot straight to their own Outlook calendar with
one click. This is not two-way booking (we can't see the candidate's real
availability or auto-confirm on the recruiter's calendar without a Microsoft
Graph API app registration) — it proposes fixed slots and lets the
candidate pick one to add, similar to any "Add to Calendar" button in a
marketing email.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

OUTLOOK_DEEPLINK_BASE = "https://outlook.office.com/calendar/deeplink/compose"
SLOT_DURATION_MINUTES = 30
SLOT_TIMES = [(11, 0), (14, 0), (16, 0)]  # 11:00, 2:00pm, 4:00pm on successive business days


@dataclass
class InterviewSlot:
    label: str
    start: datetime
    end: datetime
    outlook_url: str


def _next_business_days(count: int, start_offset_days: int = 1) -> list[datetime]:
    days: list[datetime] = []
    cursor = datetime.now() + timedelta(days=start_offset_days)
    while len(days) < count:
        if cursor.weekday() < 5:  # Mon-Fri
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def build_interview_slots(
    *,
    candidate_name: str,
    job_title: str,
    recruiter_email: str,
) -> list[InterviewSlot]:
    business_days = _next_business_days(len(SLOT_TIMES))
    subject = f"Interview: {job_title} — {candidate_name}"
    body = (
        f"Interview for the {job_title} role between {candidate_name} and the "
        f"{recruiter_email} hiring team. A video call link will follow separately."
    )

    slots: list[InterviewSlot] = []
    for day, (hour, minute) in zip(business_days, SLOT_TIMES):
        start = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
        end = start + timedelta(minutes=SLOT_DURATION_MINUTES)
        params = {
            "path": "/calendar/action/compose",
            "rru": "addevent",
            "startdt": start.strftime("%Y-%m-%dT%H:%M:%S"),
            "enddt": end.strftime("%Y-%m-%dT%H:%M:%S"),
            "subject": subject,
            "body": body,
            "location": "Video call (link to follow)",
        }
        url = f"{OUTLOOK_DEEPLINK_BASE}?{urlencode(params)}"
        hour_12 = ((start.hour + 11) % 12) + 1
        am_pm = "AM" if start.hour < 12 else "PM"
        label = f"{start.strftime('%A, %b')} {start.day} at {hour_12}:{start.minute:02d} {am_pm}"
        slots.append(InterviewSlot(label=label, start=start, end=end, outlook_url=url))
    return slots
