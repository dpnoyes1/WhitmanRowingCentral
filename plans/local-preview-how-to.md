# Preview the site locally (no Netlify build, no credits)

Use this to try a change or a PR on your Mac and your phone before anything is merged. It runs the real pages and the real `/api` code on **fake data** (made-up athletes A901+) with a pretend Google Sheet in memory. It never reads or writes the live Sheet, needs no passwords or keys, and never touches Netlify.

## Start it

From the repo folder in Terminal:

```bash
node tools/preview.mjs
```

It prints two addresses and the fake sign-ins:

- **Mac:** `http://localhost:8888`
- **Phone:** `http://<your Mac's Wi-Fi address>:8888`, shown in the printout. The phone must be on the same Wi-Fi. If it won't load, allow incoming connections for Node when macOS asks (System Settings > Network > Firewall).

Stop it with Ctrl-C. Use another port with `PORT=9000 node tools/preview.mjs`.

Page and style edits show on refresh. After changing anything in `functions/` or `lib/`, stop it and start it again. Anything you "log" or "plan" lives in memory and is gone on restart, so you can click freely.

## Preview a PR

```bash
git stash            # only if you have uncommitted changes
gh pr checkout 123   # the PR number
node tools/preview.mjs
```

Go back with `git checkout main` (and `git stash pop` if you stashed).

## Real-code mode: `netlify dev` (only when you need it)

The fake preview covers pages, sign-in, planning and logging. Use `netlify dev` only for things that need Netlify itself (scheduled functions, Slack, Concept2). It runs the functions with your real env vars, so **logging a workout or saving a plan there writes to the live Sheet.** Prefer a test copy of the Sheet.

1. Once: `npx netlify-cli login`, then `npx netlify-cli link` in the repo folder.
2. Env vars come from the linked Netlify site, or from a `.env` file in the repo root. `.env` is already in `.gitignore`; never commit it.
3. Run `npx netlify-cli dev`. It serves on `http://localhost:8888`. Sign-in cookies are `Secure`, so this only works on the Mac, not over the phone. Use the fake preview for phone checks.

To point `netlify dev` at a test copy of the Sheet, put the test copy's Apps Script URL and key in `.env` as `FEED_URL` and `FEED_KEY`.

## Which one?

| I want to... | Use |
|---|---|
| See a page or style change, on Mac and phone | `node tools/preview.mjs` |
| Check a PR before merging | `gh pr checkout N`, then the same |
| Test Slack, Concept2 or scheduled functions | `netlify dev` with a test Sheet |

The preview is not a replacement for the test suites. Before a PR: `node erg-tracker/tests/run.js && node erg-tracker/site/tests/run.mjs`, plus `node erg-tracker/site/tests/browser/run.mjs` for page changes.
