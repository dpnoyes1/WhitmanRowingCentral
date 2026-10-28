# Setup guide

How to stand up the erg tracker for a program from zero, and keep it running season to season. Whitman Rowing is the worked example: wherever you see a Whitman name, address or time, use your own.

## What you're building

| Piece | What it does | Who sees it |
|---|---|---|
| Google Sheet | The database. Apps Script inside it builds every tab, the Form and the reports. | Coaches only |
| Google Form | Athletes log each practice, OYO session and test. | Athletes (by link) |
| Team site on Netlify | Dashboards, leaderboards, stars, week ahead with targets. Reads the Sheet through a private feed. | Athletes and coaches, behind a sign-in |
| Alerts and backups | An hourly site check that tells you when the feed or sign-in breaks, and a weekly copy of the Sheet in Drive. | You |

## Accounts you need

Make these under a coaching account the program owns, not a personal one, so the next head coach can take them over.

1. **Google account** (Whitman: a coaching Gmail). Owns the Sheet, Form, Apps Script, backups and alert emails.
2. **GitHub account** with a copy of this repo (Whitman: `dpnoyes1/WhitmanRowingCentral`, private). Netlify builds the site from it.
3. **Netlify account** (free plan is enough). Hosts the team site (Whitman: `whitmanrowingcentral.netlify.app`).
4. Later, optional: **Slack** for alerts and the logging bot, and a **Concept2 Logbook** developer app for automatic sync (see the end of this guide).

Never put passwords, keys, webhook URLs or athlete data in the repo. Secrets go in Netlify environment variables or the Sheet's Script Properties; athlete data stays in the Sheet.

## Part A: Sheet and Form (about 15 minutes)

### 1. Create the Sheet and paste the script

1. Go to [sheets.new](https://sheets.new) while signed in to the program's Google account and name the spreadsheet (Whitman: **Whitman Erg Tracker**).
2. Open **Extensions > Apps Script**. A script editor opens in a new tab.
3. Name the project **Erg Tracker** (click "Untitled project" at the top).
4. Delete the sample `Code.gs` file's contents. Then for each file in this repo's `apps-script/` folder, click **+ > Script**, give it the same name without `.gs` (`Config`, `Dummy`, `Feed`, `Form`, `Gms`, `Ops`, `Plan`, `PlanSheet`, `Profile`, `Regatta`, `RegattaSheet`, `Setup`, `Sheet`, `Submit`, `TeamGms`, `TeamGmsSheet`, `Time`). clasp is quicker if you're comfortable with a terminal; see the end of Part A, and paste the file's contents. You can delete the empty `Code.gs` afterwards.
5. Click the gear icon (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**, go back to the editor and replace `appsscript.json` with the repo's version.
6. Click **Save** (the disk icon).

### 2. Run setup

1. Go back to the Sheet tab and reload the page. An **Erg Tracker** menu appears after a few seconds.
2. Click **Erg Tracker > Set up Sheet and Form**.
3. Google asks you to authorize the script. Click **Continue**, choose your account, then **Advanced > Go to Erg Tracker (unsafe) > Allow**. ("Unsafe" just means Google hasn't reviewed your personal script.)
4. Run **Set up Sheet and Form** again if it stopped after authorizing. When it finishes it shows the share link.

You now have every tab, the Form, a raw responses backup tab, and four triggers: form submit, edit logging, the hourly site check and the Sunday backup (Part C).

### 3. Fill in the basics

1. **Roster tab:** add each athlete's Name, Slack member ID, Squad, Role (Rower or Coxswain), Active = Yes, Birthday and Grad year. Leave Athlete ID blank; it fills itself. Age group and School year fill themselves from Birthday and Grad year. The Form's name lists update when you edit the Roster. If they don't, use **Erg Tracker > Refresh form name lists from Roster**.
2. **Settings tab:** check the coach names, `timezone`, `school_year_start` and the `shift.*` practice times (Whitman's are the girls' winter shifts), then set `season.winter_start` and `season.winter_end` (YYYY-MM-DD). Set `site.url` to your team site's address once you have one (Part B).
3. **Erg Tracker > Generate practice schedule** fills the Practices tab. Mark holidays and snow days as Canceled in the Status column.
4. **Weights tab** is hidden. To open it: the menu at the bottom-left (all sheets list) > Weights. Coaches type weights there directly. It is never on the Form.
5. **Team GMS:** **Erg Tracker > Team GMS report** rebuilds the "Team GMS (coach)" tab (team, squad and rank band averages, this year to date vs past years). Near the end of each season run **Erg Tracker > Save squads for this school year** so later years compare against the squads as they were.
6. **Regattas:** add one row per race on the **Races** tab (result, top 3 times, lineup by seat), then **Erg Tracker > Regatta report** rebuilds the "Regatta report (coach)" tab.

### 4. Plan a week

1. **Workouts tab** is the library. One row per piece, so a workout is one or more rows sharing a Workout ID (e.g. `PYR`).
   - Same pieces: one row with Reps, e.g. 3 x Time 20:00, Rest 2:00, Zone Aerobic.
   - Variable intervals (2000/1500/1000/500/250): one row per piece, Piece # 1 to 5, each with its own Work, Rest and target.
   - Common start (8 x 500m, everyone goes together): Reps 8, Distance 500, Start every 3:30, Rest blank. For coach-called starts, Rest = Undefined.
   - Activity defaults to Erg (RowErg). Only RowErg pieces get watts targets.
   - Target: pick Base (2k or 20') and Target low % / high %. Leave % blank to use the zone default from Settings (`target.<zone>.2000m` / `.20min`). A range (Aerobic) shows a range; one number (Threshold, Anaerobic) shows a single target.
2. **Schedule tab:** one row per session: Date, Squad (All / Varsity / Novice), Session (Practice / OYO), Workout ID. Tick **Published** when athletes should see it. To plan from last week, use **Erg Tracker > Copy last week (as drafts)**: it copies the previous week's rows 7 days forward, unpublished, and refuses if the week already has rows. Edit, then tick Published.
3. **Erg Tracker > Preview week ahead** writes a *Week ahead (preview)* tab with every athlete's targets, drafts included. FLAG rows at the top list athletes with no 2k or 20' this season or last; they get no target.
4. **Erg Tracker > Check week against plan** writes a *Plan check* tab: each logged practice, OYO and make-up checked against its planned workout (did the plan, hit target, watts per interval). Make-ups are checked against the missed day's workout.

Targets use season-best watts (school year from `school_year_start`), falling back to last season. Rejected benchmark rows are ignored. Weight is never used.

### Explore with dummy data (optional)

Before entering real athletes, run **Erg Tracker > Load dummy data**. It adds 30 made-up athletes (12 novices in 7th-9th, 18 varsity in 10th-12th) with:
- practices from Oct 5 to Oct 23, 2026, including Out days, Modified days, and make-ups
- OYO sessions; some athletes miss Required and some reach Elite
- a published plan, including the week of Oct 26 (Mon-Fri practices, Saturday Oct 31 is 60' OYO) so **Preview week ahead** has something to show
- weights
- three rounds of 2k and 20' tests (late August, September and October)

One athlete is out for 6 practices with a ramp-back week. Another has no tests yet, so she shows up as a FLAG. Not everyone improves every round.

Try **Preview week ahead** (2026-10-26) and **Check week against plan** (2026-10-05, 2026-10-12 or 2026-10-19).

**Erg Tracker > Clear dummy data** removes only the dummy rows. It finds them by these marks:
- Athlete IDs A901 and up
- `DUMMY` in Roster Notes and Weights Note
- Source `Dummy`
- `-DUMMY-` in Entry and Benchmark IDs
- `DUMMY-` at the start of Workout IDs

Clear it before adding real athletes.

### 5. Share

- Share the link saved in **Settings > form.share_url** with athletes. Use that link, not the Form's plain link: it prefills drag factor 105. Warmup is typed each day because it changes.
- Share the Sheet itself only with coaches.

### 6. Test it

Submit one Practice with two intervals and one 2000m test through the share link, then check:
- Entries has one row, with Warmup s = whatever warmup you typed (15:00 = 900).
- Intervals has two rows.
- Benchmarks has the 2k with Time s in seconds (7:42.8 -> 462.8), and Entries has a second row for that test session with the same Benchmark ID.

Delete the test rows when you're done (the Change log will record the deletions as edits).

### If something goes wrong

- A submission didn't appear: check the **Change log** for a `SUBMIT ERROR` row. The usual cause is an athlete name not on the Roster. Fix the Roster, then run **Erg Tracker > Process missed form responses**. It only adds responses that aren't already in the Sheet.
- Every raw answer is also in the **Form responses (raw)** tab, so nothing is lost.
- To change a question's wording, ask Claude to change it in `Config.gs`, then paste the new file and run **Erg Tracker > Rebuild form (new link)**. Editing the question directly in the Form editor breaks the link between that question and the Sheet.

### Optional: clasp instead of copy/paste

If you'd rather push code from the repo: `npm i -g @google/clasp`, `clasp login`, enable the Apps Script API at script.google.com/home/usersettings, copy the script ID from Project Settings into `.clasp.json` as `{"scriptId": "...", "rootDir": "apps-script"}`, then `clasp push`.

## Part B: Team site (about 20 minutes)

Follow `site/README.md` (One-time setup). In short:

1. In the Sheet: **Erg Tracker > Site feed key**, then publish the feed as a web app (Execute as Me, access Anyone). Copy its URL.
2. In Netlify: **Add new project > Import from Git**, pick your copy of this repo. `netlify.toml` at the repo root sets everything else.
3. Add the environment variables `TEAM_PASSWORD`, `FEED_KEY` and `FEED_URL` (secret values ticked), then deploy.
4. In the Sheet's Settings, set `site.url` to the site's address, and add the coaches' sign-ins to `site.coaches`. Athletes sign in with their name and birthday (or `site.test_password` while you're testing).

To make it look like your program, change the name in `site/public/index.html` and `site/public/app.js` ("Whitman Rowing"), the colors in `site/public/style.css`, the Form title in `apps-script/Form.gs`, and the short links in `netlify.toml` (`/logworkout` points at your Form's share link).

## Part C: Alerts and backups (5 minutes)

1. Reload the Sheet and click **Erg Tracker > Turn on alerts and backups**. Google asks you to allow a few more things (send email, fetch web pages, create files in Drive): allow them. It shows what the site check sees right now.
   - **Do this right after any update that adds these permissions.** Until you allow them, the Form's submit trigger can't run either.
2. **Alerts.** Every hour the Sheet checks the team site: the home page loads, the site can read the feed, the data isn't stale, and athletes have sign-in codes. When something breaks you get one alert, a reminder once a day while it stays broken, and one "working again" message. A form submission that can't be saved also alerts you (details stay in the Change log). Alerts go by email to `alerts.email` in Settings (blank: the Sheet's owner), or to Slack once you set that up.
3. **Monday list.** At 7:00 every Monday (Eastern, the script's time zone) the Sheet sends one message naming active rowers who are missing a 2k or a 20' test this school year or last (each name says which), so some or all of her targets are blank. It sends nothing when everyone has both. It goes to the same place as alerts (Slack or email).
4. **Backups.** Every Sunday night a values-only copy of every tab goes into the Drive folder **Erg tracker backups**. The newest 12 are kept (`backup.keep`); older ones go to the Drive trash. **Erg Tracker > Back up now** makes one any time. A backup is a plain spreadsheet: to restore a tab, copy its rows back into the live Sheet.

The backups hold everything in the Sheet, weights and birthdays included, so keep the folder private to coaches.

### Slack alerts (optional, later)

1. Go to <https://api.slack.com/apps>, **Create New App > From scratch**, name it (e.g. "Erg Tracker") and pick your workspace.
2. Open **Incoming Webhooks**, turn it on, click **Add New Webhook to Workspace**, and pick where alerts go: your own DM or a private channel such as #erg-alerts.
3. Copy the webhook URL (starts with `https://hooks.slack.com/`). In the Sheet: **Erg Tracker > Slack alerts webhook**, paste it, OK. A test message arrives in Slack.

### Plan flags with buttons (optional, after the Slack alerts webhook)

Every 15 minutes the Sheet checks the last 3 days of entries. A session logged Full that doesn't match its plan gets one message in the Slack alert channel with three buttons: **Set to Modified**, **Looks right** and **Open in Sheet**. Pressing a button changes the entry (Status, or Review status "Reviewed, Full"), writes a Change log row ("Slack, name"), and replaces the message with who decided. The first press wins.

1. In Settings, set `slack.coach_ids` to the Slack member IDs of the coaches who may press the buttons, separated by commas (in Slack: profile, then Copy member ID). Run **Set up Sheet and Form** once if the row isn't there yet.
2. In the Slack app: turn **Interactivity** on and set its Request URL to `https://<your site>/api/slack`.
3. In Netlify, set `SLACK_SIGNING_SECRET` (Slack app, Basic Information). `FEED_URL` and `FEED_KEY` are already set for the site.
4. Reload the Sheet and run **Turn on alerts and backups** so the 15-minute trigger is installed.

Without a webhook or without coach IDs nothing is posted or changed.

### /log in Slack (optional, after the plan-flag buttons)

`/log` works for coaches (David, Greta and Forrest, the member IDs in `slack.coach_ids`) and for athletes. An athlete is recognized by the **Slack member ID on her active Roster row** (Slack proves who she is, so no birthday is asked); she can log only for herself and leaves the Athlete box blank (typing another name is refused). A coach types the athlete's full name. A Slack account that is neither gets a message to ask a coach to add the ID to the Roster, or use the Form. Type `/log` in Slack (a DM with the bot works too) and fill in the same questions as the Google Form (date, what is being logged, activity, warmup, main set, zone, RPE, drag factor and so on). The pieces go in one box, one line each: work time, meters, rate, rest time, rest meters. Slack shows any mistake next to the field. When the coach presses Save the entry is written through the same parser as the Form (Source = Slack, Entered by = "Coach name" for a coach or her own name for an athlete), and the bot sends a short "Saved" message. A session that doesn't match the plan also gets the Plan check message. Tests and Benchmarks stay on the Form.

1. Set `slack.coach_ids` in Settings (see the plan-flag steps above). The athlete's name must match an active Roster row.
2. In the Slack app: **Slash Commands**, `/log`, Request URL `https://<your site>/api/slack`. The Interactivity Request URL is the same address.
3. Netlify needs `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` (the bot token opens the form and sends the "Saved" message). The bot scopes are `commands` and `chat:write`.
4. Push the Apps Script and publish a new feed version (the Slack function calls the Sheet through the same URL and key as the site).

### Erg-screen photos in Slack (optional, after /log)

Coaches (the IDs in `slack.coach_ids`) and athletes (found by the Slack member ID on the Roster) can use this. Someone sends a photo of an erg monitor to the bot in a direct message. The bot reads it with the Claude API and checks the numbers add up. For a coach it replies with what it read and asks which athlete it is for (a caption with the athlete's name skips that question); for an athlete the session is always her own, so it goes straight to the card and a caption can't redirect it. The coach replies with the full name, and the bot shows a card: tap the session RPE (1 to 10) or **Save without RPE**, or Cancel. Saving writes a Practice, Full entry through the same parser as the Form (Source = Slack, Entered by = "Coach name" or the athlete herself). Warmup, zone and drag factor stay blank because the screen doesn't show them. A single piece saves its totals (the splits go in the note); an interval workout saves each piece with the rest from the title. If the numbers don't add up, the date looks wrong, or only some intervals are visible, the bot says so and saves nothing; the coach sends a clearer photo or uses `/log`. The photo itself is not kept yet.

1. In the Slack app: **Event Subscriptions** on, Request URL `https://<your site>/api/slack` (it must show Verified), and under *Subscribe to bot events* add `message.im` only. Reinstall the app if Slack asks. Scopes needed: `chat:write`, `im:history`, `files:read`.
2. Netlify: `ANTHROPIC_API_KEY` (a key with a monthly spend limit, in Netlify environment variables only).
3. Push the Apps Script and publish a new feed version (new actions `slack-access` and `slack-photo`).

The URL is a secret: it's saved in the script's properties, never in a cell or the repo. Leaving the box empty turns Slack off and alerts go back to email. The same Slack app can later grow into the logging bot.

## Part D: Each new school year

Results, stars, leaderboards and targets already start over on `school_year_start` (Jul 1 at Whitman); nothing needs resetting, and All Time boards keep every result. Between the last race and the first fall practice:

1. **Erg Tracker > Start new school year.** It closes out the year (the one that just ended if you run it in the first three months after `school_year_start`, otherwise the current one) and asks before doing anything. It:
   - saves an archive copy of the whole Sheet as "Erg tracker archive 2026-27" in the backups folder (never trashed),
   - saves each rower's squad for that year (Squad history), so Team GMS compares against the squads as they were,
   - sets athletes whose Grad year is that year or earlier to Active = No (logged in the Change log). They stay in the history and on All Time boards.

   It never deletes anything.
2. Then by hand: move novices up on the Roster and add new athletes, set the new `season.winter_start` / `season.winter_end` and run **Generate practice schedule**, clear `site.test_password` if athletes now use their birthdays, and change `TEAM_PASSWORD` in Netlify (then redeploy).

## Part E: Later

- **Concept2 Logbook sync** (planned): register an app at <https://log.concept2.com/developers> under the program's account, read-only, with the callback `https://<your site>/.netlify/functions/concept2-callback`. The client secret goes in Netlify environment variables only.
- **Logbook confirmation in Slack** (built, off until Logbook sync is on): when a Logbook session lands, an athlete whose Roster row has her Slack member ID gets a DM from the bot with an optional effort pick and **Confirm** / **Change** buttons (and **Confirm as 2k/20' test** when it looks like one). The team-site card still works; the first tap wins. Make-ups wait for a tap, other sessions count after 20 hours. Needs the Slack app's Interactivity on, `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in Netlify, and a Sheet push plus a new feed version.
- **Slack bot, later parts** (planned): the 9:00 "not logged" reminder and erg-screen photos, built on the Slack app from Part C.
- **Another program's copy**: everything above, under that program's own Google, GitHub, Netlify, Slack and Concept2 accounts. Nothing is shared between copies.
