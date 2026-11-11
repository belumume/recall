// Checks the app's engine against answers produced by the Python engine
// (test/make_fixtures.py). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGrades, replay, dueToday, renderIssue, endOfLocalDay, zoneOf } from "../app/js/engine.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const settings = load("settings.json");
const cards = load("cards.json");

test("local days end at the same instant, also where clocks change at midnight", () => {
  for (const [zone, days] of Object.entries(load("days.json"))) {
    for (const [day, end] of Object.entries(days)) {
      assert.equal(new Date(endOfLocalDay(day, zone)).toISOString(), new Date(end).toISOString(), `${zone} ${day}`);
    }
  }
});

test("a missing time zone is refused, not guessed", () => {
  assert.throws(() => zoneOf({}), /timezone/);
});

test("written grades are read the same way", () => {
  for (const g of load("grades.json")) {
    const got = Object.fromEntries([...parseGrades(g.text, g.numbers)].map(([k, v]) => [String(k), v]));
    assert.deepEqual(got, g.out, g.text);
  }
});

for (const seed of [1, 2, 3]) {
  test(`history ${seed}: same due lists, issues, dates and memory state`, async () => {
    const h = load(`history-${seed}.json`);
    const issues = new Map(h.issues.map((i) => [i.number, i]));
    const items = h.items.map(([n, c]) => [issues.get(n), c]);
    // Every day: replay what had been graded before that day, then pick the cards.
    let issueIndex = 0;
    for (const d of h.dues) {
      const before = items.slice(0, d.graded_before);
      const { state, rows } = await replay(settings, cards, {}, [], before);
      const { chosen, nNew } = dueToday(settings, cards, state, d.day);
      assert.deepEqual(chosen.map((c) => c.id), d.ids, `due list on ${d.day}`);
      assert.equal(nNew, d.new);
      if (chosen.length) {
        const issue = h.issues[issueIndex++];
        const { title, body } = renderIssue(settings, chosen, nNew, d.day, rows);
        assert.equal(title, issue.title);
        assert.equal(body, issue.body, `issue body on ${d.day}`);
      }
    }
    const { state, rows } = await replay(settings, cards, {}, [], items);
    assert.equal(rows.length, h.rows.length);
    rows.forEach((r, i) => {
      const p = h.rows[i];
      assert.equal(r.card, p.card);
      assert.equal(r.rating, p.rating);
      assert.equal(Date.parse(r.next_due), Date.parse(p.next_due), `next due of ${p.card} at ${p.reviewed_at}`);
    });
    for (const [id, p] of Object.entries(h.state)) {
      assert.equal(Date.parse(state[id].due), Date.parse(p.due), id);
      assert.ok(Math.abs(state[id].stability - p.stability) < 1e-9, `stability ${id}`);
      assert.ok(Math.abs(state[id].difficulty - p.difficulty) < 1e-9, `difficulty ${id}`);
    }
  });
}
