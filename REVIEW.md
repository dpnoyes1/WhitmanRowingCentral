# Review checklist

David's standing rules. Every thread checks these before it opens a PR, and a reviewer checks them again. Add a rule here when David states a new one.

## Before you open a PR

1. `node erg-tracker/tests/run.js && node erg-tracker/site/tests/run.mjs` both pass.
2. If you changed anything under `erg-tracker/site/public/` (pages, CSS, markup): also run `node erg-tracker/site/tests/browser/run.mjs`. It needs Playwright (cloud sessions have it). It opens every page at 320, 360, 390, 768, 820 and 1280 px as an athlete and a coach on fake data, and clicks through sign-in, planning a workout and logging an activity. See "Browser checks" below.
3. Preview it locally on fake data: `node tools/preview.mjs` (Mac and phone; see `plans/local-preview-how-to.md`). No Netlify build is used.
4. Look at your change on a phone-width and a desktop-width screenshot of fake data when the page's look changed.

## David's rules

- **No sideways scrolling.** Anything that scrolls sideways on a phone or desktop (a wide table, a chart, a row of chips) must be reviewed by David before it is merged or pushed. Flag it in the project chat and wait for his go. A new entry in `erg-tracker/site/tests/browser/known-scroll.json` counts as sideways scrolling: do not add one without David's go.
- **Neutral wording.** No gendered words in site, ErgBot or Slack text (no her / she / girls for people in general). Use the person's name, "they", or rewrite. Athlete names and the team name David uses are not changed.
- **A club, not a school.** The team is a legally unaffiliated club, not Whitman HS or MCPS. Never say "high school" or imply a school affiliation. "School year" as a date range is fine.
- **Apps Script before merge.** If the site calls a new Sheet action, the Apps Script has to be pushed (and the "Team site feed" version updated) before the site PR is merged. David's clear go authorizes the push (see `erg-tracker/CLAUDE.md`, "Apps Script pushes"); on his Mac a go that only gets forwarded to the session is refused, so ask him to write it himself. Say in the PR when a push is needed.
- **Merge only on David's go.** Deploy previews are off, so every merge is a build. Batch a session's work into one PR. Never merge on your own.
- **Three strikes.** After about three failed attempts to fix the same failure, stop and ask David. Do not patch around a failing test, skip it, loosen it, or quarantine it to get green.
- **Fake data only.** No athlete names, results, weights or birthdays in the repo, tests or screenshots. Dummy data must be clearly fake (IDs A901+). No passwords, keys or tokens.
- **Weight is coach-only.** Never on a page athletes can see, never phrased as a way to earn stars.

## Browser checks

`node erg-tracker/site/tests/browser/run.mjs [scroll|e2e]` (about 15 seconds). It starts a local copy of the site (`tests/browser/server.mjs`: real `/api` handlers, the dummy feed, a small fake Sheet), so nothing real is read or written. It is not part of the Netlify build, which has no browser.

- `scroll.mjs`: lists every page that scrolls sideways (the whole page, or a box with its own scroll bar). `known-scroll.json` holds the ones already found and waiting for a fix; a NEW one fails the run, and a listed one that no longer happens is reported so you can delete the line. Re-write the list only with David's go: `SCROLL_WRITE_KNOWN=1 node erg-tracker/site/tests/browser/run.mjs scroll`.
- `e2e.mjs`: sign-in (including first password), plan a workout, log an activity. Add a flow here when a change touches one of them. Keep them fast, on fake data, with no fixed sleeps.
- If a page needs a Sheet action the fake does not know, add it to `makeSheet` in `server.mjs`.
