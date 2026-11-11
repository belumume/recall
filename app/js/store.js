// Gathers everything the app needs from your repo, works out today's
// questions exactly as the Python engine would, keeps a copy on the phone for
// offline use, and sends your grades back as one comment per sitting.

import yaml from "../vendor/js-yaml.mjs";
import { GitHub } from "./github.js";
import { Rating } from "./fsrs.js";
import {
  SWEEP_DAYS, replay, dueToday, renderIssue, issueMap, issueDay, localDate, makeScheduler,
  applyRating, gradeComment, questionText, timesReviewed, addDays, zoneOf,
} from "./engine.js";

const KEYS = { config: "recall.config", snapshot: "recall.snapshot", outbox: "recall.outbox" };

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: keep going */ }
}

export function getConfig() { return read(KEYS.config, null); }
export function setConfig(c) { write(KEYS.config, c); }
export function forget() { for (const k of Object.values(KEYS)) try { localStorage.removeItem(k); } catch { /* */ } }

function parseCsv(text) {
  const lines = (text || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
}

// Grades waiting to be sent: [{ issue, n, rating, at }].
function outbox() { return read(KEYS.outbox, []); }

// The pending grades as comment-shaped items, so a replay counts them. The
// record will date each one by when its comment reaches GitHub, not when it
// was tapped, so they are replayed as if sent now.
function pendingItems(issues) {
  const byNum = new Map(issues.map((i) => [i.number, i]));
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return outbox().filter((g) => byNum.has(g.issue)).map((g, k) => [byNum.get(g.issue), {
    id: `local-${g.at}-${k}`, created_at: now,
    user: { type: "User" }, author_association: "OWNER", body: `${g.n} ${["", "again", "hard", "good", "easy"][g.rating]}`,
  }]);
}

export class Store {
  constructor(config) {
    this.config = config; // { token, repo, dir }
    this.gh = new GitHub(config.token, config.repo);
    this.data = read(KEYS.snapshot, null); // last good copy, for offline use
  }

  path(name) { return `${this.config.dir ? this.config.dir.replace(/\/$/, "") + "/" : ""}${name}`; }

  // Fetch everything fresh. Throws if GitHub can't be reached.
  async sync({ openIssue = true } = {}) {
    const gh = this.gh;
    const since = new Date(Date.now() - SWEEP_DAYS * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const [cardsText, settingsText, stateText, logText, issues] = await Promise.all([
      gh.file(this.path("cards.yml")), gh.file(this.path("settings.yml")),
      gh.fileOrNull(this.path("state.json")), gh.fileOrNull(this.path("log.csv")), gh.reviewIssues(since),
    ]);
    const comments = await Promise.all(issues.map((i) => gh.comments(i.number)));
    this.data = {
      fetchedAt: Date.now(),
      cards: yaml.load(cardsText, { schema: yaml.CORE_SCHEMA, json: true }) || [],
      settings: yaml.load(settingsText, { schema: yaml.CORE_SCHEMA, json: true }) || {},
      state: stateText ? JSON.parse(stateText) : {},
      log: parseCsv(logText),
      issues: issues.map((i) => ({ number: i.number, title: i.title, body: i.body, state: i.state })),
      comments: comments.map((list) => list.map((c) => ({ id: c.id, created_at: c.created_at,
        user: { type: c.user && c.user.type }, author_association: c.author_association, body: c.body }))),
    };
    write(KEYS.snapshot, this.data);
    if (openIssue) await this.openTodayIfMissing();
    return this.data;
  }

  get settings() { return this.data.settings; }
  get tz() { return zoneOf(this.settings); }
  today() { return localDate(Date.now(), this.tz); }

  // Replay every grade (saved, in comments, and still waiting on this phone).
  async compute() {
    const d = this.data;
    const items = [];
    d.issues.forEach((issue, k) => { for (const c of d.comments[k] || []) items.push([issue, c]); });
    items.push(...pendingItems(d.issues));
    const { state, rows } = await replay(d.settings, d.cards, d.state, d.log, items);
    this.state = state;
    this.rows = d.log.concat(rows);
    return this.view();
  }

  // Today's questions: from today's issue if there is one, else what is due.
  view() {
    const d = this.data;
    const today = this.today();
    const issue = d.issues.find((i) => issueDay(i) === today) || null;
    const byId = new Map(d.cards.map((c) => [c.id, c]));
    const seen = timesReviewed(this.rows);
    let items = [];
    let nNew = 0;
    if (issue) {
      const graded = new Set(this.rows.filter((r) => String(r.issue) === String(issue.number)).map((r) => r.card));
      for (const [n, cid] of [...issueMap(issue)].sort((a, b) => a[0] - b[0])) {
        const card = byId.get(cid);
        if (card) items.push({ n, card, done: graded.has(cid), question: questionText(card, Math.max(0, (seen[cid] || 0) - (graded.has(cid) ? 1 : 0))) });
      }
    } else {
      const due = dueToday(d.settings, d.cards, this.state, today);
      nNew = due.nNew;
      items = due.chosen.map((card, k) => ({ n: k + 1, card, done: false, question: questionText(card, seen[card.id] || 0) }));
    }
    return { today, issue, items, nNew, offline: !navigator.onLine };
  }

  // Open today's issue the way the morning run does, if nobody has yet.
  async openTodayIfMissing() {
    const d = this.data;
    const today = this.today();
    if (d.issues.some((i) => issueDay(i) === today)) return;
    await this.compute();
    const { chosen, nNew } = dueToday(d.settings, d.cards, this.state, today);
    for (const [k, i] of d.issues.entries()) {
      if (i.state === "open" && issueDay(i) && issueDay(i) < today) {
        const graded = new Set(this.rows.filter((r) => String(r.issue) === String(i.number)).map((r) => r.card));
        const mapping = issueMap(i);
        const done = mapping.size > 0 && [...mapping.values()].every((c) => graded.has(c));
        await this.gh.comment(i.number, done ? "All done for that day. ✅" :
          "Not answered here: those questions are in today's issue instead.");
        await this.gh.closeIssue(i.number);
        d.issues[k] = { ...i, state: "closed" };
      }
    }
    if (!chosen.length) return;
    const extra = this.rows.slice(d.log.length);
    const { title, body } = renderIssue(d.settings, chosen, nNew, today, extra);
    const made = await this.gh.openIssue(title, body, d.settings.assignee);
    d.issues.unshift({ number: made.number, title: made.title, body: made.body, state: made.state });
    d.comments.unshift([]);
    write(KEYS.snapshot, d);
  }

  // When each grade would bring the card back, for the buttons.
  async preview(card) {
    const scheduler = makeScheduler(this.settings);
    const now = Date.now();
    const out = {};
    for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      const state = { [card.id]: this.state[card.id] };
      const due = await applyRating(this.settings, scheduler, card, state, r, Math.floor(now / 1000) * 1000);
      out[r] = daysBetween(this.today(), localDate(due, this.tz));
    }
    return out;
  }

  // Record one grade on the phone at once; sending happens in flush().
  grade(issueNumber, n, rating) {
    const box = outbox();
    box.push({ issue: issueNumber, n, rating, at: Date.now() });
    write(KEYS.outbox, box);
  }

  pendingCount() { return outbox().length; }

  // True only when GitHub can see the repo, its issues are switched on, and the
  // issue itself is gone. A 404 can also mean the token lost access, and a 410
  // that issues were switched off, so both are checked before anything is dropped.
  async issueGone(number) {
    try {
      await this.gh.call(`/repos/${this.config.repo}/issues/${number}`);
      return false;
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) return false;
      try { return Boolean((await this.gh.call(`/repos/${this.config.repo}`)).has_issues); } catch { return false; }
    }
  }

  // Send waiting grades, one comment per issue. Safe to call often.
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const box = outbox();
      if (!box.length) return true;
      const byIssue = new Map();
      for (const g of box) {
        if (!byIssue.has(g.issue)) byIssue.set(g.issue, new Map());
        const m = byIssue.get(g.issue);
        if (!m.has(g.n)) m.set(g.n, g.rating); // the first grade for a question counts
      }
      let failure = null;
      for (const [issue, grades] of byIssue) {
        const sent = box.filter((g) => g.issue === issue);
        const drop = () => write(KEYS.outbox, outbox().filter((g) => !sent.some((s) => s.at === g.at && s.n === g.n && s.issue === g.issue)));
        let made;
        try {
          made = await this.gh.comment(issue, gradeComment(grades));
        } catch (e) {
          // A deleted issue can never take its grades; anything else is kept to retry.
          if ((e.status === 404 || e.status === 410) && await this.issueGone(issue)) drop();
          else failure ||= e;
          continue; // one failing issue must not hold back the others
        }
        const k = this.data.issues.findIndex((i) => i.number === issue);
        if (k >= 0) (this.data.comments[k] ||= []).push({ id: made.id, created_at: made.created_at,
          user: { type: "User" }, author_association: made.author_association, body: made.body });
        drop();
      }
      write(KEYS.snapshot, this.data);
      if (failure) throw failure;
      return true;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  // Numbers for the stats screen.
  stats() {
    const tz = this.tz;
    const today = this.today();
    const rows = this.rows;
    const perDay = {};
    for (const r of rows) {
      const day = localDate(Date.parse(r.reviewed_at), tz);
      perDay[day] = (perDay[day] || 0) + 1;
    }
    const firstSeen = new Set();
    const decks = {};
    const lapses = {};
    for (const r of [...rows].sort((a, b) => Date.parse(a.reviewed_at) - Date.parse(b.reviewed_at))) {
      const card = this.data.cards.find((c) => c.id === r.card);
      const deck = card ? card.deck : "?";
      if (r.rating === "again") lapses[r.card] = (lapses[r.card] || 0) + 1;
      if (!firstSeen.has(r.card)) { firstSeen.add(r.card); continue; } // a first sight is not a test of memory
      decks[deck] ||= { reviews: 0, remembered: 0 };
      decks[deck].reviews += 1;
      if (r.rating !== "again") decks[deck].remembered += 1;
    }
    const leeches = Object.entries(lapses).filter(([, n]) => n >= 4)
      .map(([id, n]) => ({ card: this.data.cards.find((c) => c.id === id), lapses: n })).filter((x) => x.card);
    const exams = Object.entries(this.settings.exams || {}).map(([deck, date]) => {
      const cards = this.data.cards.filter((c) => c.deck === deck && !c.suspended);
      return { deck, name: (this.settings.deck_names || {})[deck] || deck, date: String(date),
        days: daysBetween(today, String(date)), total: cards.length,
        started: cards.filter((c) => firstSeen.has(c.id)).length };
    }).filter((e) => e.days >= 0).sort((a, b) => a.days - b.days);
    let streak = 0;
    for (let d = today; perDay[d]; d = addDays(d, -1)) streak++;
    if (!perDay[today]) for (let d = addDays(today, -1); perDay[d]; d = addDays(d, -1)) streak++;
    return { perDay, decks, leeches, exams, streak, total: rows.length, cards: this.data.cards.filter((c) => !c.suspended).length, seen: firstSeen.size };
  }
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
