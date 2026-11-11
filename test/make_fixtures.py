"""Builds test/fixtures/*.json from the Python engine (reviews/srs.py), so the
JavaScript engine can be checked against it answer for answer.

Run: python test/make_fixtures.py /path/to/folder/with/srs.py
It uses the example deck in example/, never anyone's own cards.
"""
import json
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, sys.argv[1])
import srs  # noqa: E402

EXAMPLE = Path(__file__).resolve().parent.parent / "example"
srs.CARDS, srs.SETTINGS = EXAMPLE / "cards.yml", EXAMPLE / "settings.yml"

OUT = Path(__file__).parent / "fixtures"
settings = srs.load_settings()
cards = srs.load_cards()
rng = random.Random(7)

# 1. Written grades: many phrasings, as the student might dictate them.
phrases = ["1 good, 2 again, 3-5 hard", "all good", "one good two wrong rest easy",
           "1st good 2nd okay", "Q3 failed, q4: easy", "number 2 is shaky", "1 to 3 good and 4 again",
           "everything perfect", "2 and 4 forgot, others right", "1 good 1 again", "nothing here",
           "**1** good, `2` easy", "3 - 5 correct", "six missed", "the rest unsure", "1, 2 & 3 partly",
           "\u0661 good \u0662 again", "\u06f3-\u06f5 easy", "\u0967 hard"]
words = ["good", "again", "hard", "easy", "wrong", "right", "rest", "all", "and", "to", "one", "two",
         "three", "1", "2", "3", "4", "5", "6", "-", ",", "q", "number", "is", "ok", "shaky"]
for _ in range(300):
    phrases.append(" ".join(rng.choice(words) for _ in range(rng.randint(1, 9))))
grades = [{"text": p, "numbers": list(range(1, 7)),
           "out": {str(k): int(v) for k, v in srs.parse_grades(p, list(range(1, 7))).items()}}
          for p in phrases]
(OUT / "grades.json").write_text(json.dumps(grades, indent=0))

# 2. Whole histories: daily issues and grade comments over many weeks,
#    replayed by the Python engine, with the due list for every day.
def history(seed: int, days: int):
    r = random.Random(seed)
    state: dict = {}
    issues, items, dues = [], [], []
    start = datetime(2026, 12, 1, 9, 0, tzinfo=timezone.utc)
    srs.load_cards = lambda: cards
    srs.read_log = lambda: []
    for d in range(days):
        day_start = start + timedelta(days=d)
        today = srs.local_today(settings, day_start)
        srs.load_state = lambda: {}
        out: dict = {}
        srs.apply_comments(settings, items, save=False, out=out)
        chosen, n_new = srs.due_today(settings, cards, out["state"], today)
        dues.append({"day": today.isoformat(), "ids": [c["id"] for c in chosen], "new": n_new,
                     "graded_before": len(items)})
        if not chosen:
            continue
        title, body = srs.render_issue(settings, chosen, n_new, today, extra_rows=out["rows"], bridge=True)
        issue = {"number": 100 + d, "title": title, "body": body}
        issues.append(issue)
        if r.random() < 0.25:
            continue  # a skipped day
        n = len(chosen)
        when = day_start + timedelta(hours=r.randint(1, 14), minutes=r.randint(0, 59), seconds=r.randint(0, 59))
        ratings = ["again", "hard", "good", "easy"]
        text = ", ".join(f"{i} {r.choice(ratings)}" for i in range(1, n + 1) if r.random() < 0.9)
        items.append((issue, {"id": 5000 + d, "created_at": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                              "user": {"type": "User"}, "author_association": "OWNER", "body": text}))
        if r.random() < 0.2:  # a second, later comment the same day (first grade wins)
            items.append((issue, {"id": 9000 + d, "created_at": (when + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                  "user": {"type": "User"}, "author_association": "OWNER", "body": "all easy"}))
    srs.load_state = lambda: {}
    out = {}
    srs.apply_comments(settings, items, save=False, out=out)
    return {"issues": issues, "items": [[i["number"], c] for i, c in items], "dues": dues,
            "rows": out["rows"], "state": {k: {"due": v["due"], "stability": v["stability"],
                                                "difficulty": v["difficulty"]} for k, v in out["state"].items()}}

for seed in (1, 2, 3):
    (OUT / f"history-{seed}.json").write_text(json.dumps(history(seed, 70)))
(OUT / "settings.json").write_text(json.dumps(settings, default=str))
(OUT / "cards.json").write_text(json.dumps(cards, default=str))

# 4. Local days in seven zones whose clocks change (some at midnight) and one that
# never does: the end of each day around every change from 2015 to 2026, as
# srs.end_of_local_day gives it.
zones = ["Europe/London", "America/Santiago", "America/Havana", "America/Asuncion",
         "Atlantic/Azores", "Asia/Gaza", "Australia/Lord_Howe", "Asia/Tokyo"]
days = {}
for z in zones:
    s = dict(settings, timezone=z)
    prev = None
    for k in range(4383):
        d = date(2015, 1, 1) + timedelta(days=k)
        end = srs.end_of_local_day(s, d)
        off = end.astimezone(srs.tz(s)).utcoffset()
        if off != prev:
            for dd in (d - timedelta(days=2), d - timedelta(days=1), d, d + timedelta(days=1)):
                days.setdefault(z, {})[dd.isoformat()] = srs.end_of_local_day(s, dd).isoformat()
        prev = off
(OUT / "days.json").write_text(json.dumps(days, indent=0))
print("fixtures written")
