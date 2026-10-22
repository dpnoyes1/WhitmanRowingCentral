# Whitman Rowing Central

Home for Whitman Rowing's coaching tools. Owner: David Noyes (Head Coach). David prefers clarifying questions before building.

| Folder | What | Status |
|---|---|---|
| `erg-tracker/` | Erg and OYO training tracker, girls pilot (Google Sheet + Form + Apps Script, Netlify dashboards later) | Session 1: Sheet, Form, Apps Script |

Each tool keeps its own rules in its folder's `CLAUDE.md`. Read it before changing that tool.

Repo-wide rules:
- Never commit passwords, API keys or tokens. Netlify sites read them from environment variables.
- Athlete data (names, results, weights) never goes in the repo. It lives in the Google Sheet, which only coaches can open. Dummy data for testing is fine and must be clearly fake.
