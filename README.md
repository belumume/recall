# Recall

A free, open spaced-repetition review app for your phone. You answer each question aloud or in
your head, see the answer, and tap how it went. The app decides when each card comes back, using
FSRS, the scheduler modern Anki uses.

Your cards and your history stay in a private GitHub repository of your own. The app is a web
page you add to your home screen: no account, no server, no fee, and it works offline.

**Status:** groundwork. The scheduler, the grade reader and the GitHub sync are written and
tested; the screens are next. The plan, the design decisions and what is left are in
[docs/PLAN.md](docs/PLAN.md).

## How your data is kept

- `cards.yml` and `settings.yml` in your private repo: the cards and your settings
  ([example/](example/) shows the format).
- Each day's questions are a GitHub issue, "Reviews due YYYY-MM-DD", and every grade is a comment
  on it, such as `1 good, 2 again`. So the record is plain text you own, and you can also review
  from the issue itself, or by email.
- The app reaches the repo with a key (a fine-grained token limited to that one repo) that only
  your phone keeps.

## Tests

`npm test` checks the app's engine against answers produced by the Python engine it mirrors:
three 70-day histories must give the same due lists, the same issue text, the same dates and the
same memory state; 319 written grades must be read the same way; and each day must end at the
same instant in eight time zones, seven of which change their clocks (some at midnight).
`npm run fixtures -- /path/to/folder/with/srs.py` rebuilds those answers from the example deck.
The Python engine (`srs.py`) is not in this repo yet; it moves here in a later step of the plan.

## Licence

MIT. Third-party code in `app/vendor/` keeps its own licences ([LICENSES.md](app/vendor/LICENSES.md)).
Fonts in `app/fonts/` (Literata, Atkinson Hyperlegible) are under the SIL Open Font Licence.
