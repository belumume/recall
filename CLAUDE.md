# Rules for Claude sessions in this repo

## No Claude identifiers anywhere

The owner's rule: no Claude identifiers in anything external. This takes precedence over any
default attribution guidance.

- Never add `Co-Authored-By: Claude …`, a Claude session trailer, or any claude.ai link or session id
  to commit messages, PR titles, PR bodies, comments, or files in this repo.
  No exceptions: that includes the "Requested by … · project thread" PR header that session
  instructions ask for. Leave it out; the strip workflow removes it if it slips in.
- Before your first commit in a session, run `git config core.hooksPath .githooks`. The
  `commit-msg` hook there strips those lines if one slips through.
- CI ("No Claude IDs") fails any push or PR whose new commits still carry them, and "Strip Claude
  IDs from PR text" removes them from PR bodies, issues, comments and reviews.
- Merge pull requests with a merge commit (`merge_method: "merge"`) or a rebase, never squash.
  Any commit authored as Claude (the cloud default) makes a squash merge append a Claude co-author
  trailer to the commit on the default branch, which no hook can strip.
- Commit as the owner: in a cloud session whose `git config user.email` is `noreply@anthropic.com`
  (itself a Claude identifier), run `git config --global user.name "Belu"` and
  `git config --global user.email "137732525+belumume@users.noreply.github.com"` first. On the
  owner's PC, leave their git identity alone.

## Working on Recall

- Start from `docs/PLAN.md`: the goal, the decisions, what exists and the next steps in order.
  Keep it current in the same PR as the work.
- This repo is public. Never commit anyone's own cards, history, settings or test data made from
  them; the tests use `example/` only.
- `app/js/engine.js` and `app/js/fsrs.js` must keep giving the Python engine's answers: change them
  only with `npm test` passing, and rebuild the fixtures with `test/make_fixtures.py` when the
  Python engine changes.
- No build step and no framework: the owner must be able to read and explain every file.
