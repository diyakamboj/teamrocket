"""Calendar & Microsoft Teams Integration Service.

Connects to Outlook calendar data (simulated/mock schedules for team interviewers
like Alex Chen, Priya Sharma, Sarah Jenkins, David Kim, as well as optional MS Graph API),
computes available time slots for multi-participant interviews, and generates
Microsoft Teams meeting credentials and Outlook calendar invites (.ics & deeplinks).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import random
from typing import Any, Optional
from urllib.parse import urlencode

from app.models.interview import TimeSlot

OUTLOOK_DEEPLINK_BASE = "https://outlook.office.com/calendar/deeplink/compose"

# Default mock team interviewers and their predefined schedules/titles
INTERVIEWERS = [
    {
        "name": "Alex Chen",
        "email": "alex.chen@example.com",
        "title": "Lead Software Engineer",
        "busy_patterns": [(9, 10), (12, 13), (15, 16)],  # Hours busy each day
    },
    {
        "name": "Priya Sharma",
        "email": "priya.sharma@example.com",
        "title": "Senior Technical Recruiter / Hiring Manager",
        "busy_patterns": [(10, 11.5), (13, 14), (16, 17)],
    },
    {
        "name": "Sarah Jenkins",
        "email": "sarah.jenkins@example.com",
        "title": "Staff Backend Engineer",
        "busy_patterns": [(9.5, 11), (14, 15.5)],
    },
    {
        "name": "David Kim",
        "email": "david.kim@example.com",
        "title": "Principal Architect",
        "busy_patterns": [(11, 12), (14.5, 16)],
    },
]


def list_known_interviewers() -> list[dict[str, str]]:
    """Return available interviewers list for UI selection."""
    return [
        {
            "name": p["name"],
            "email": p["email"],
            "title": p["title"],
        }
        for p in INTERVIEWERS
    ]


def generate_teams_meeting(
    *,
    subject: str,
    start_time: datetime,
    end_time: datetime,
    organizer_email: str,
) -> dict[str, str]:
    """Generates realistic Microsoft Teams meeting details.
    Includes join URL, meeting ID, passcode, and toll-free conference call details.
    """
    meeting_hash = hashlib.sha256(f"{subject}-{start_time.isoformat()}-{organizer_email}".encode()).hexdigest()[:12]
    thread_id = f"19:meeting_{meeting_hash}@thread.v2"
    context = urlencode({"context": f'{{"Tid":"72f988bf-86f1-41af-91ab-2d7cd011db47","Oid":"{meeting_hash[:8]}-4321-4321-4321-1234567890ab"}}'})
    
    teams_join_url = f"https://teams.microsoft.com/l/meetup-join/{thread_id}/0?{context}"
    meeting_id = f"{random.randint(100, 999)} {random.randint(100, 999)} {random.randint(1000, 9999)}"
    passcode = "".join(random.choices("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=6))
    
    return {
        "teams_link": teams_join_url,
        "teams_meeting_id": meeting_id,
        "teams_passcode": passcode,
        "location": "Microsoft Teams Meeting",
        "conference_id": f"{random.randint(100000000, 999999999)}#",
    }


def build_ics_content(
    *,
    title: str,
    description: str,
    start_time: datetime,
    end_time: datetime,
    location: str,
    organizer_email: str,
    attendees: list[str],
) -> str:
    """Creates a standard iCalendar (.ics) format string."""
    fmt = "%Y%m%dT%H%M%SZ"
    st = start_time.astimezone(timezone.utc).strftime(fmt)
    et = end_time.astimezone(timezone.utc).strftime(fmt)
    dtstamp = datetime.now(timezone.utc).strftime(fmt)
    uid = hashlib.md5(f"{title}-{st}".encode()).hexdigest() + "@resumeiq.com"

    attendee_lines = "\r\n".join(
        [f"ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:MAILTO:{a}" for a in attendees]
    )
    # RFC 5545 escapes newlines inside TEXT values. Precomputed because a
    # backslash inside an f-string expression is a SyntaxError before 3.12.
    escaped_description = description.replace("\n", "\\n")

    ics = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//ResumeIQ Recruiter Copilot//Interview Scheduler//EN\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "METHOD:REQUEST\r\n"
        "BEGIN:VEVENT\r\n"
        f"UID:{uid}\r\n"
        f"DTSTAMP:{dtstamp}\r\n"
        f"DTSTART:{st}\r\n"
        f"DTEND:{et}\r\n"
        f"SUMMARY:{title}\r\n"
        f"DESCRIPTION:{escaped_description}\r\n"
        f"LOCATION:{location}\r\n"
        f"ORGANIZER;CN=Recruiter:MAILTO:{organizer_email}\r\n"
        f"{attendee_lines}\r\n"
        "STATUS:CONFIRMED\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )
    return ics


def build_outlook_deeplink(
    *,
    subject: str,
    body: str,
    start_time: datetime,
    end_time: datetime,
    location: str,
) -> str:
    """Builds Outlook web calendar deeplink compose URL."""
    params = {
        "path": "/calendar/action/compose",
        "rru": "addevent",
        "startdt": start_time.strftime("%Y-%m-%dT%H:%M:%S"),
        "enddt": end_time.strftime("%Y-%m-%dT%H:%M:%S"),
        "subject": subject,
        "body": body,
        "location": location,
    }
    return f"{OUTLOOK_DEEPLINK_BASE}?{urlencode(params)}"


def _is_slot_free(
    candidate_start: datetime,
    duration_minutes: int,
    interviewer_names: list[str],
) -> tuple[bool, list[str]]:
    """Checks if requested slot is free for all requested interviewers."""
    slot_end = candidate_start + timedelta(minutes=duration_minutes)
    hour_start = candidate_start.hour + candidate_start.minute / 60.0
    hour_end = slot_end.hour + slot_end.minute / 60.0

    # Business hours check (9am to 5pm)
    if hour_start < 9.0 or hour_end > 17.5:
        return False, []

    available = []
    for inv in INTERVIEWERS:
        name = inv["name"]
        # Check against requested interviewers (if specified)
        if interviewer_names and not any(r.lower() in name.lower() for r in interviewer_names):
            continue

        busy_patterns = inv.get("busy_patterns", [])
        has_conflict = False
        for b_start, b_end in busy_patterns:
            if max(hour_start, b_start) < min(hour_end, b_end):
                has_conflict = True
                break

        if not has_conflict:
            available.append(name)

    # If interviewer_names specified, all must be available
    if interviewer_names:
        matched_all = all(
            any(a.lower() in req.lower() for a in available)
            for req in interviewer_names
        )
        return matched_all, available

    return len(available) >= 1, available


def find_available_slots(
    *,
    required_interviewers: list[str],
    duration_minutes: int = 45,
    start_days_ahead: int = 1,
    num_slots: int = 3,
    candidate_name: str = "Candidate",
    job_title: str = "Role",
) -> list[TimeSlot]:
    """Finds top available time slots matching participant availability."""
    proposed_slots: list[TimeSlot] = []
    now = datetime.now()
    cursor = now + timedelta(days=start_days_ahead)

    # Search across the next 10 business days
    days_checked = 0
    while len(proposed_slots) < num_slots and days_checked < 10:
        if cursor.weekday() < 5:  # Monday - Friday
            # Test potential slot start times: 9:30, 11:00, 14:00, 15:30
            for start_hour, start_min in [(9, 30), (11, 0), (14, 0), (15, 30)]:
                slot_start = cursor.replace(
                    hour=start_hour, minute=start_min, second=0, microsecond=0
                )
                slot_end = slot_start + timedelta(minutes=duration_minutes)

                is_free, available = _is_slot_free(slot_start, duration_minutes, required_interviewers)
                if is_free:
                    hour_12 = ((slot_start.hour + 11) % 12) + 1
                    am_pm = "AM" if slot_start.hour < 12 else "PM"
                    day_str = slot_start.strftime("%A, %b %d")
                    label = f"{day_str} at {hour_12}:{slot_start.minute:02d} {am_pm} ({duration_minutes} mins)"

                    subject = f"Interview: {job_title} — {candidate_name}"
                    body = f"Interview with {candidate_name} for {job_title} role. Required participants: {', '.join(available)}."
                    deeplink = build_outlook_deeplink(
                        subject=subject,
                        body=body,
                        start_time=slot_start,
                        end_time=slot_end,
                        location="Microsoft Teams Meeting",
                    )

                    slot = TimeSlot(
                        start_time=slot_start,
                        end_time=slot_end,
                        label=label,
                        available_interviewers=available if available else required_interviewers,
                        is_recommended=len(proposed_slots) == 0,
                        outlook_url=deeplink,
                    )
                    proposed_slots.append(slot)
                    if len(proposed_slots) >= num_slots:
                        break
        cursor += timedelta(days=1)
        days_checked += 1

    # Fallback if no matching slot found in mock patterns
    if not proposed_slots:
        cursor = now + timedelta(days=2)
        while cursor.weekday() >= 5:
            cursor += timedelta(days=1)
        fallback_start = cursor.replace(hour=14, minute=0, second=0, microsecond=0)
        fallback_end = fallback_start + timedelta(minutes=duration_minutes)
        label = f"{fallback_start.strftime('%A, %b %d')} at 2:00 PM ({duration_minutes} mins)"
        deeplink = build_outlook_deeplink(
            subject=f"Interview: {job_title} — {candidate_name}",
            body=f"Interview with {candidate_name}",
            start_time=fallback_start,
            end_time=fallback_end,
            location="Microsoft Teams Meeting",
        )
        proposed_slots.append(
            TimeSlot(
                start_time=fallback_start,
                end_time=fallback_end,
                label=label,
                available_interviewers=required_interviewers or ["Alex Chen", "Priya Sharma"],
                is_recommended=True,
                outlook_url=deeplink,
            )
        )

    return proposed_slots
