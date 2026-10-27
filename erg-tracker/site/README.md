# Team site (whitmanrowingcentral.netlify.app)

Athlete-facing pages for the erg tracker, behind a sign-in: athletes use their name and birthday, coaches the coach password (TEAM_PASSWORD). Plain HTML/JS plus Netlify Functions. There is no framework and no build step.

```
public/      index.html, app.js, style.css (hash routes: #/team, #/week, #/boards, #/stars (coaches only), #/oyo, #/athletes, #/athlete/A001, #/week/A001 and #/week/prev for coaches, #/me, #/workout/E-ID)
functions/   refresh-feed.mjs (every 5 minutes), login.mjs (/api/login, /api/logout), api.mjs (/api/session, /api/team, /api/athlete/:id, /api/leaderboards, /api/stars (coaches only), /api/oyo, /api/week, /api/week/:id, /api/workout/:id)
lib/         auth.mjs (password, signed cookie), feed.mjs (reads the Sheet via a shared Netlify Blobs copy),
             stats.mjs (minutes, completion, streaks, bests), views.mjs (what each page gets)
netlify.toml short links: /logworkout goes to the Google Form, /guide to the logging guide (a Google Doc).
             Both are linked from the sign-in page, the menu and the Today card.
scripts/     dummy-feed.js: the feed built from the dummy data, for local work and tests
tests/       run.mjs: `node erg-tracker/site/tests/run.mjs`
```

## How data flows

1. The Sheet's Apps Script publishes a private web app (`apps-script/Feed.gs`). It only answers a POST that carries the feed key.
2. `functions/refresh-feed.mjs` runs every 5 minutes on the live site and saves the feed to Netlify Blobs (store `feed`, key `latest`; `@netlify/blobs` in the root `package.json`). `lib/feed.mjs` serves that copy, keeps it in memory for a minute, and asks the Sheet directly only when the copy is missing or over 15 minutes old. If the Sheet is down, the last copy (up to a day old) is shown with a stale note.
3. `lib/views.mjs` shapes it for each page. Multipliers, OYO goals and completion are applied here, when the data is read.

The feed never sends weight, birthday dates, coach notes, Slack IDs or Roster notes. For sign-in it sends one keyed code per athlete (`logins`), which never leaves the server. GMS % and stars are worked out in the Sheet; each athlete's GMS % goes only to her own page and to coaches.

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
3. Go to **Project configuration > Environment variables > Add a variable**, and add `TEAM_PASSWORD` and `FEED_KEY` (tick "Contains secret values" on both) and `FEED_URL`.
   - Secret variables start with a Production value only. Also fill in **Deploy Previews**, or the preview sign-in says "The site is not set up yet".
   - `FEED_KEY` is the 64-character key (digits and a-f) from the Sheet, not Netlify's gray "somevalue" placeholder.
4. Go to **Deploys > Trigger deploy > Deploy project**. New env values only take effect on the next deploy.

Deploy previews (one per pull request) are behind a Netlify login, so only coaches with Netlify access can open them. The live site needs a sign-in.

## Local check

`node erg-tracker/tests/run.js && node erg-tracker/site/tests/run.mjs` runs both test suites. Netlify runs them as the build command, so a failing test stops a deploy.

## Health check

`functions/health.mjs` answers `POST /api/health` with `{"key": FEED_KEY}`: whether the env vars are set, the feed loads and is fresh, and athletes have sign-in codes (counts and times only). Without the key it says nothing. The Sheet calls it every hour (`apps-script/Ops.gs`) and alerts the head coach when something breaks; see `docs/SETUP.md` Part C.
