# Recall: plan and state

This file is the resume point for the app itself. Read it, then `README.md`, then the code in
`app/js/`. The owner's personal setup (their data repo, schedules, dates) is recorded privately,
not here.

## The goal

Review software of one's own: free forever, never missed (an app plus a reminder that cannot be
dropped), improving over time toward the best of Mochi, Anki, Orbit, Quantum Country, Andy
Matuschak's and Geoffrey Litt's work and the learning research, and open source.

It grows out of an earlier flow that sent a question list every day as a GitHub issue and asked for
grades as a typed reply. That flow got almost no reviews: typing the reply was too much effort, and
a reminder alone did not lead to reviewing. So the measure of success is reviews
actually done, daily, with as few taps and as little typing as possible: one tap from the reminder
to the first question, answers by voice, grades by one tap or one spoken word.

## Decisions (11 Nov 2026)

| Decision | Why |
| --- | --- |
| A web app added to the phone's home screen (a PWA), hosted free on GitHub Pages from this public repo | Free with no quota to run out; installable; works offline; no app store |
| The owner's cards and history stay in their private repo; the app reads and writes it with a fine-grained token kept only on the phone | Nothing personal in this repo; no server to run or pay for |
| Grades are written as comments on the day's "Reviews due" issue, in the same words the Python engine already reads (`1 good, 2 again`) | One record, readable by people, by the Python engine and by Claude; the issue and email still work as a fallback |
| The JavaScript engine gives the Python engine's answers, down to Python's random numbers (YAML quirks aside, see Known gaps) | The app and the morning run must agree on what is due and when a card returns, or the record splits |
| If nobody has opened today's issue (the morning run failed, Claude usage ran out, Actions is off), the app opens it itself, in the same format | Reviews never depend on Claude or on GitHub Actions minutes |
| No build step, no framework: plain ES modules, three vendored libraries | Anyone who reads basic HTML, CSS and JS can explain and change every part |
| Literata for card text (made for long reading on screens), Atkinson Hyperlegible for controls (made for legibility) | Real typefaces chosen for reading and legibility, served from this repo so they work offline |
| MIT licence, public repo | Owner's choice, 11 Nov 2026 |

## What exists

- `app/js/fsrs.js`: FSRS-6 matching py-fsrs 6.3.2 with no learning steps, plus Python's
  Mersenne Twister and `random.seed(str)`, so the random spread on intervals matches too.
- `app/js/engine.js`: the rules of the Python engine (`srs.py`): due list, exam rules
  (a miss returns the next day; no gap over 21 days before an exam; one review in exam week),
  dictation-friendly grade reading, replay of grade comments, the issue text.
- `app/js/github.js`: the GitHub calls (files, issues, comments, all pages of a list).
- `app/js/store.js`: sync, offline copy on the phone, today's questions, grade outbox (grades are
  saved on the phone at once and sent as one comment per issue), interval preview for the grade
  buttons, numbers for a stats screen (reviews per day, retention per deck, leeches, exam countdowns,
  streak). Written but not yet exercised by a screen or a test.
- `example/`: an example deck and settings (no personal data); the tests use only these.
- `test/`: `make_fixtures.py` runs the Python engine on the example deck; `parity.test.mjs` checks
  the JS engine gives the same due lists, issue text, dates, stability and difficulty over three
  70-day histories, reads 319 written grades the same way (Arabic-Indic and other digits too), and
  ends each local day at the same instant in eight time zones, seven of which change their clocks
  (some at midnight).
  All pass.
- `app/vendor/`: js-yaml 4.1.0, marked 12.0.2, DOMPurify 3.1.6 (licences in `LICENSES.md`).
- `app/fonts/`: Literata (Latin) and Atkinson Hyperlegible 400/700, woff2.

## Next steps, in order

1. **Screens** (`app/index.html`, `app/app.css`, `app/js/main.js`):
   - Today: how many questions and about how long; one big Start button; exam countdowns.
   - Review: deck, question in large type; "Say your answer" (Web Speech API) shows the words heard;
     "Show answer"; the key ideas (the **bold** words of the answer) ticked if they were said;
     four big grade buttons, Forgot / Shaky / Got it / Easy, each showing when the card would
     return ("tomorrow", "9 days"); colour is never the only signal.
   - Hands-free mode: the question is read aloud, the answer heard, the model answer shown, and the
     grade taken by voice ("got it", "forgot"). Taps always work too.
   - Done: "All 6 done", whether the grades reached GitHub or are waiting on the phone, and what
     tomorrow holds.
   - Stats: reviews per day (12-week grid), retention per deck, leeches (forgotten 4+ times: rewrite
     them), streak.
   - Connect: one button opens GitHub's token page, one button pastes the key from the clipboard.
     Repo and folder come prefilled from the link (`?repo=owner/name&dir=reviews`).
   - Cards render Markdown and inline SVG pictures, sanitised with DOMPurify.
   - Palette from paper and ink, a deep pine accent; light and dark; contrast measured (WCAG AA);
     tap targets at least 48 px; checked at real phone size.
2. **Offline and install**: service worker caching the app shell; `manifest.webmanifest`; icon (a
   forgetting curve lifted back up at each review, the spaced-repetition "sawtooth").
3. **Tests for the screens**: Playwright against a fake GitHub (routes intercepted), covering first
   connect, a full sitting, offline grading then sending, the app opening today's issue, and the
   stats. Screenshots of every screen at phone size, looked at before anything ships.
4. **Hosting**: GitHub Pages publishing the `app/` folder through a Pages workflow in GitHub
   Actions (free on a public repo; publishing straight from a branch only serves the root or
   `docs/`). Repo settings writes are blocked from cloud sessions, so switching Pages on and
   "merge commits or rebase, no squash" are done from the owner's PC with `gh`.
5. **The owner's one step**: make the fine-grained token (Repository access: only their private
   data repo; permissions: Issues read and write, Contents read). Check whether GitHub
   still accepts prefilled fields in the new-token URL
   (`/settings/personal-access-tokens/new?name=...&target_name=...&expires_in=...&issues=write&contents=read`);
   if it does, the Connect button uses it so the owner only presses Generate and then Paste.
6. **Reminders that cannot be dropped**: a recurring calendar event with alarms (morning and
   evening) linking to the app, sent through the owner's usual alert route; plus the daily push the
   morning run already sends.
7. **Move the Python engine here** (`srs.py`, `test_srs.py`, the daily workflow) after a date kept
   in the owner's private notes, and once the app is in daily use, keeping the data in their
   private repo; then `make_fixtures.py` points at this repo's copy, and every document that points at the old engine is updated.
8. **Later, with evidence**: fit FSRS weights to the owner's own log at about 400 reviews; pictures
   on more cards; interleaving; ideas from the learning research still to be read in full.

## Constraints

- Free forever: nothing that bills when a quota runs out. Actions on this public repo are free;
  nothing may depend on Actions minutes in a private repo.
- The daily reviews must keep working while the app is built: the existing morning run keeps
  opening the issue until the app does.
- No Claude identifiers in commits, PRs, issues or files (see `CLAUDE.md`).
- Every change gets an independent review; anything the owner sees gets a cold read by a fresh
  reader and is rendered and looked at first.

## Known gaps

- The issue text `renderIssue` writes copies the Python engine's current wording word for word
  (it mentions the owner's chat-based review), so the two stay identical. When the Python engine
  moves here, make that wording a setting.
- `store.js` has no tests yet; the screen tests (step 3) cover it, including: a grade queued offline
  is replayed as if sent now, because the record dates it by when its comment arrives; one issue
  that refuses comments does not hold back the others; grades for a deleted issue are dropped,
  but only after checking that the repo is visible and its issues are on, so a token that has lost
  access keeps its grades queued.
- Still open in `store.js`: if the app closes after a comment is posted but before the queue is
  saved, the grade is posted twice (harmless the same day, a second review after midnight); the app
  and the morning run could open the same day's issue at the same moment. Fix both before the app
  opens issues by itself.
- YAML: the app reads YAML 1.2 (js-yaml), the Python engine YAML 1.1 (PyYAML). They differ on
  plain values like `no`, `on`, `010` and `1:30`; quote such values in cards and settings. A
  repeated key keeps the last value in both.
- `settings.yml` must name a `timezone`; the app refuses to guess.
