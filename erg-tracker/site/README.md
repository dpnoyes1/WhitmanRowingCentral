# Team site (whitmanrowingcentral.netlify.app)

Athlete-facing pages for the erg tracker, behind one shared team password. Plain HTML/JS plus Netlify Functions. There is no framework and no build step.

```
public/      index.html, app.js, style.css (hash routes: #/team, #/athletes, #/athlete/A001, #/me, #/pick)
functions/   login.mjs (/api/login, /api/logout), api.mjs (/api/team, /api/athlete/:id)
lib/         auth.mjs (password, signed cookie), feed.mjs (reads the Sheet, 5-minute cache),
             stats.mjs (minutes, completion, streaks, bests), views.mjs (what each page gets)
scripts/     dummy-feed.js: the feed built from the dummy data, for local work and tests
tests/       run.mjs: `node erg-tracker/site/tests/run.mjs`
```

## How data flows

1. The Sheet's Apps Script publishes a private web app (`apps-script/Feed.gs`). It only answers a POST that carries the feed key.
2. `lib/feed.mjs` calls it from the server and keeps the result for 5 minutes.
3. `lib/views.mjs` shapes it for each page. Multipliers, OYO goals and completion are applied here, when the data is read.

The feed never sends weight, birthdays, coach notes, Slack IDs or Roster notes. GMS % and stars are worked out in the Sheet, and only those results go out. Layer 1 pages show neither (they come with the leaderboards and stars layer). Each athlete's GMS % will appear only on her own page.

## Environment variables (Netlify, never in the repo)

| Name | What |
|---|---|
| `TEAM_PASSWORD` | Shared athlete password. Changing it signs everyone out. Rotate each season. |
| `FEED_KEY` | The key from **Erg Tracker > Site feed key** in the Sheet. Mark it as secret. |
| `FEED_URL` | The Apps Script web app URL (ends in `/exec`). |
| `COACH_PASSWORD` | For the coach view later. Not used yet. |

## One-time setup

### A. Publish the feed from the Sheet

1. Get the latest scripts into the Sheet (clasp push, or paste `Feed.gs`, `Setup.gs` and `appsscript.json`).
2. Reload the Sheet and click **Erg Tracker > Site feed key**. Copy the key it shows.
3. In the Apps Script editor, click **Deploy > New deployment**. Next to "Select type", click the gear and choose **Web app**.
   - Description: `Team site feed`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** and authorize if asked. Copy the **Web app URL**.

"Anyone" only means Google doesn't ask the caller to sign in. Without the key, the feed returns nothing.

When `Feed.gs` (or anything it uses) changes later, update the same deployment so the URL stays the same: **Deploy > Manage deployments**, then the pencil, then **Version: New version**, then **Deploy**.

### B. Netlify

1. Open the project at <https://app.netlify.com/projects/whitmanrowingcentral>.
2. Go to **Project configuration > Build & deploy > Continuous deployment**, click **Link repository**, and pick GitHub, then `dpnoyes1/WhitmanRowingCentral`, branch `main`. Leave the build fields as Netlify fills them from `netlify.toml`.
3. Go to **Project configuration > Environment variables > Add a variable**, and add `TEAM_PASSWORD`, `FEED_KEY` (tick "Contains secret values") and `FEED_URL`. Use the same value for every deploy context.
4. Go to **Deploys > Trigger deploy > Deploy project**. New env values only take effect on the next deploy.

Deploy previews (one per pull request) are behind a Netlify login, so only coaches with Netlify access can open them. The live site only needs the team password.

## Local check

`node erg-tracker/tests/run.js && node erg-tracker/site/tests/run.mjs` runs both test suites. Netlify runs them as the build command, so a failing test stops a deploy.
