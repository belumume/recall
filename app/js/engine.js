// The review rules, written to match reviews/srs.py line for line, so the app
// and the Python engine always agree on what is due and when a card comes back.
// Every grade lives in one place: comments on the day's "Reviews due" issue.

import { Scheduler, Rating, RATING_NAMES, pythonRandom } from "./fsrs.js";

export const LABEL = "reviews";
export const SWEEP_DAYS = 30;
export const GRADER_ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const DAY_MS = 86400000;
const MAP_RE = /<!-- reviews-map: (\{.*?\}) -->/;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// ---------------------------------------------------------------- dates in the student's time zone

// "YYYY-MM-DD" of an instant in time zone `tz`.
export function localDate(ms, tz) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms));
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function offsetMs(ms, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}

const HOUR_MS = 3600000;

// The instant local midnight starts on `day` ("YYYY-MM-DD"), as Python's
// datetime.combine(day, time(0), tzinfo=ZoneInfo(tz)) gives it. Where the
// clocks change at midnight, Python uses the offset from before the change:
// for a skipped midnight that is the moment of the change, which the new
// clocks read as 01:00.
export function localMidnight(day, tz) {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const before = offsetMs(wall - 36 * HOUR_MS, tz);
  const after = offsetMs(wall + 36 * HOUR_MS, tz);
  if (offsetMs(wall - before, tz) === before) return wall - before;
  if (offsetMs(wall - after, tz) === after) return wall - after;
  return wall - before; // midnight was skipped
}

// The settings' time zone. Required: the Python engine's fallback is a
// personal one, so the app refuses to guess.
export function zoneOf(settings) {
  if (!settings.timezone) throw new Error("settings.yml needs a timezone, e.g. timezone: Europe/London");
  return settings.timezone;
}

export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// srs.py end_of_local_day: the first instant of the next local day.
export function endOfLocalDay(day, tz) {
  return localMidnight(addDays(day, 1), tz);
}

// Python's datetime.isoformat() for a UTC instant with whole seconds,
// e.g. 2026-11-12T10:00:00+00:00. Used to seed the random spread.
export function pyIso(ms) {
  const d = new Date(ms);
  const base = d.toISOString().slice(0, 19);
  const micro = (ms % 1000) * 1000;
  return micro ? `${base}.${String(micro).padStart(6, "0")}+00:00` : `${base}+00:00`;
}

// ---------------------------------------------------------------- scheduling

export function makeScheduler(settings) {
  return new Scheduler({
    desiredRetention: Number(settings.desired_retention ?? 0.9),
    maximumInterval: Number(settings.maximum_interval_days ?? 365),
  });
}

// srs.py apply_rating: one FSRS review plus the exam rules. Changes `state`
// and returns the next due time (ms).
export async function applyRating(settings, scheduler, card, state, rating, whenMs) {
  const tz = zoneOf(settings);
  const random = await pythonRandom(`${card.id}|${pyIso(whenMs)}`);
  const c = scheduler.review(state[card.id] || null, rating, whenMs, random);
  let due = Date.parse(c.due);
  if (rating === Rating.Again) {
    // A miss comes back in the next day's issue.
    due = Math.min(due, endOfLocalDay(localDate(whenMs, tz), tz));
  }
  const exam = (settings.exams || {})[card.deck];
  if (exam) {
    const examDay = String(exam);
    const examStart = endOfLocalDay(addDays(examDay, -1), tz);
    if (whenMs < examStart) {
      // Until the exam, no gap longer than about three weeks.
      const gap = Number(settings.max_gap_before_exam_days ?? 21) * DAY_MS;
      if (due > whenMs + gap) due = whenMs + gap;
      // And one review in the exam week.
      const weekStart = endOfLocalDay(addDays(examDay, -8), tz);
      const eve = endOfLocalDay(addDays(examDay, -2), tz);
      if (whenMs < weekStart && due > eve) due = eve;
    }
  }
  c.due = new Date(due).toISOString();
  state[card.id] = c;
  return due;
}

// srs.py due_today: overdue and due reviews first, then new cards.
export function dueToday(settings, cards, state, today) {
  const tz = zoneOf(settings);
  const cutoff = endOfLocalDay(today, tz);
  const reviews = [], fresh = [];
  for (const c of cards) {
    if (c.suspended) continue;
    const s = state[c.id];
    if (!s) fresh.push(c);
    else if (Date.parse(s.due) < cutoff) reviews.push([Date.parse(s.due), c]);
  }
  reviews.sort((a, b) => a[0] - b[0]);
  const cap = Number(settings.max_per_day ?? 15);
  const chosen = reviews.map((x) => x[1]).slice(0, cap);
  const room = Math.max(0, Math.min(Number(settings.new_per_day ?? 6), cap - chosen.length));
  const exams = settings.exams || {};
  const order = new Map(cards.map((c, i) => [c.id, i]));
  fresh.sort((a, b) => {
    const ea = String(exams[a.deck] ?? "9999-12-31"), eb = String(exams[b.deck] ?? "9999-12-31");
    return ea < eb ? -1 : ea > eb ? 1 : order.get(a.id) - order.get(b.id);
  });
  const newOnes = fresh.slice(0, room);
  return { chosen: chosen.concat(newOnes), nNew: newOnes.length };
}

// ---------------------------------------------------------------- grades written in words

const RATING_WORDS = {
  again: 1, wrong: 1, forgot: 1, missed: 1, fail: 1, failed: 1,
  hard: 2, shaky: 2, unsure: 2, partly: 2,
  good: 3, right: 3, correct: 3, ok: 3, okay: 3,
  easy: 4, instant: 4, perfect: 4,
};
const NUMBER_WORDS = [];
"zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
  .split(" ").forEach((w, i) => NUMBER_WORDS.push([w, String(i)]));
NUMBER_WORDS.push(["first", "1"], ["second", "2"], ["third", "3"], ["fourth", "4"], ["fifth", "5"]);

// Python's \d matches every decimal digit (Arabic-Indic ٢ too); turn them
// into 0-9 first so the patterns below read them the same way.
function asciiDigits(text) {
  return text.replace(/\p{Nd}/gu, (ch) => {
    let start = ch.codePointAt(0);
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((ch.codePointAt(0) - start) % 10);
  });
}

// srs.py parse_grades: "1 good, 2 again, 3-5 hard", "all good", "rest easy".
export function parseGrades(text, numbers) {
  let t = asciiDigits(text).toLowerCase();
  t = t.replace(/[`*_>]/g, " ");
  t = t.replace(/\b(number|no\.|card|question|q)\s*/g, " ");
  t = t.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1");
  for (const [w, d] of NUMBER_WORDS) t = t.replace(new RegExp(`\\b${w}\\b`, "g"), d);
  t = t.replace(/\b(\d+)\s*(?:to|through|thru)\s*(\d+)\b/g, "$1-$2");
  const words = Object.keys(RATING_WORDS).sort((a, b) => b.length - a.length).join("|");
  const spec = String.raw`\d+(?:\s*-\s*\d+)?(?:\s*(?:,|and|&)\s*\d+(?:\s*-\s*\d+)?)*`;
  const pat = new RegExp(String.raw`(all|everything|the rest|rest|others|${spec})\s*[:=.)\-–]?\s*(?:is|was|were|are)?\s*\b(${words})\b`, "g");
  const out = new Map();
  for (const m of t.matchAll(pat)) {
    const who = m[1], rating = RATING_WORDS[m[2]];
    let targets;
    if (who === "all" || who === "everything") targets = [...numbers];
    else if (who === "the rest" || who === "rest" || who === "others") targets = numbers.filter((n) => !out.has(n));
    else {
      targets = [];
      for (const part of who.split(/\s*(?:,|and|&)\s*/)) {
        if (part.includes("-")) {
          const [a, b] = part.split("-").map((x) => parseInt(x, 10));
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) targets.push(n);
        } else if (part.trim()) targets.push(parseInt(part, 10));
      }
    }
    for (const n of targets) if (numbers.includes(n)) out.set(n, rating);
  }
  return out;
}

// What the app writes when it records grades: "1 good, 3 again".
export function gradeComment(grades) {
  return [...grades].sort((a, b) => a[0] - b[0]).map(([n, r]) => `${n} ${RATING_NAMES[r]}`).join(", ");
}

// ---------------------------------------------------------------- issues

export function issueMap(issue) {
  const m = MAP_RE.exec(issue.body || "");
  if (!m) return new Map();
  return new Map(Object.entries(JSON.parse(m[1])).map(([k, v]) => [Number(k), v]));
}

export function issueDay(issue) {
  const m = DATE_RE.exec(issue.title || "");
  return m ? m[1] : null;
}

// srs.py apply_comments with save=False: replay every grade comment not yet in
// the log on top of state.json. Returns { state, rows }.
export async function replay(settings, cards, state0, log, items) {
  const tz = zoneOf(settings);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const state = structuredClone(state0);
  const scheduler = makeScheduler(settings);
  const done = new Set(log.map((r) => String(r.comment)));
  const gradedOn = new Map();
  for (const r of log) {
    const d = localDate(Date.parse(r.reviewed_at), tz);
    if (!gradedOn.has(d)) gradedOn.set(d, new Set());
    gradedOn.get(d).add(r.card);
  }
  const rows = [];
  const sorted = items.map((x, i) => [x, i]).sort((a, b) =>
    a[0][1].created_at < b[0][1].created_at ? -1 : a[0][1].created_at > b[0][1].created_at ? 1 : a[1] - b[1]);
  for (const [[issue, c]] of sorted) {
    if (done.has(String(c.id))) continue;
    if ((c.user || {}).type === "Bot" || !GRADER_ROLES.has(c.author_association)) continue;
    const mapping = issueMap(issue);
    if (!mapping.size) continue;
    const when = Date.parse(c.created_at);
    const day = localDate(when, tz);
    if (!gradedOn.has(day)) gradedOn.set(day, new Set());
    const already = gradedOn.get(day);
    const numbers = [...mapping.keys()].sort((a, b) => a - b);
    const grades = [...parseGrades(c.body || "", numbers)].sort((a, b) => a[0] - b[0]);
    for (const [n, rating] of grades) {
      const cid = mapping.get(n);
      if (already.has(cid)) continue;
      already.add(cid);
      const card = byId.get(cid);
      if (!card) continue;
      const next = await applyRating(settings, scheduler, card, state, rating, when);
      rows.push({ reviewed_at: new Date(when).toISOString(), card: cid, rating: RATING_NAMES[rating],
        issue: String(issue.number), comment: String(c.id), next_due: new Date(next).toISOString() });
    }
  }
  return { state, rows };
}

// srs.py question_text: rotate through the wordings in `q`.
export function questionText(card, timesReviewed) {
  let q = card.q;
  if (Array.isArray(q)) q = q[timesReviewed % q.length];
  return String(q).trim();
}

export function timesReviewed(rows) {
  const n = {};
  for (const r of rows) n[r.card] = (n[r.card] || 0) + 1;
  return n;
}

// srs.py render_issue (bridge wording), so an issue the app opens looks the
// same as one the morning run opens.
export function renderIssue(settings, chosen, nNew, today, rows) {
  const title = `Reviews due ${today} (${chosen.length})`;
  const lines = [
    `**${chosen.length} question${chosen.length !== 1 ? "s" : ""} today**` +
      (nNew ? ` (${nNew} new)` : "") + ". This is your reminder; the questions are below with each answer folded.",
    "",
    "**Best: answer them in the Claude chat** (the daily recall card): Claude hears your answer, " +
      "marks it and asks it in new words, and records the result here for you.",
    "",
    "If Claude isn't available, do them here instead: reply with how each went, for example " +
      "`1 good, 2 again, 3-5 good` or `all good`. " +
      "**again** = wrong or forgot, **hard** = right but shaky, **good** = right, **easy** = instant.",
    "",
    "Replies are read the next morning, so there is no instant \"Recorded\" reply for now.",
    "",
  ];
  const names = settings.deck_names || {};
  const done = timesReviewed(rows);
  const mapping = {};
  chosen.forEach((c, k) => {
    const i = k + 1;
    mapping[i] = c.id;
    const deck = names[c.deck] ?? c.deck.toUpperCase();
    lines.push(`### ${i}. ${deck}: ${questionText(c, done[c.id] || 0)}`, "",
      "<details><summary>Answer</summary>", "", String(c.a).trim(), "", "</details>", "");
    if (String(c.why || "").trim()) {
      lines.push("<details><summary>Why / more</summary>", "", String(c.why).trim(), "", "</details>", "");
    }
  });
  lines.push(`<!-- reviews-map: ${pyJsonDumps(mapping)} -->`);
  return { title, body: lines.join("\n") };
}

// json.dumps with Python's default separators: {"1": "a", "2": "b"}.
function pyJsonDumps(obj) {
  return "{" + Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") + "}";
}
