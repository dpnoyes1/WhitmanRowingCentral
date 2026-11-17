# Whitman Rowing Central

Home for Whitman Rowing's coaching tools. Owner: David Noyes (Head Coach). David prefers clarifying questions before building.

| Folder | What | Status |
|---|---|---|
| `erg-tracker/` | Erg and OYO training tracker, girls pilot (Google Sheet + Form + Apps Script; team site in `erg-tracker/site/` on Netlify) | Sheet, Form, Apps Script live; team site layer 1 |

Each tool keeps its own rules in its folder's `CLAUDE.md`. Read it before changing that tool.

`netlify.toml` at the repo root builds the whitmanrowingcentral.netlify.app site from `erg-tracker/site/`.

Repo-wide rules:
- Read `REVIEW.md` (David's standing review checklist) before opening a PR, and check your change against it.
- Verify before every commit: `node erg-tracker/tests/run.js && node erg-tracker/site/tests/run.mjs` (run `npm install` once first for sharp). A change is not done until both pass. If you changed the site's pages or CSS, also run `node erg-tracker/site/tests/browser/run.mjs` (sideways-scroll sweep and click-through tests; needs Playwright, not part of the Netlify build).
- Never commit passwords, API keys or tokens. Netlify sites read them from environment variables.
- Athlete data (names, results, weights) never goes in the repo. It lives in the Google Sheet, which only coaches can open. Dummy data for testing is fine and must be clearly fake.
