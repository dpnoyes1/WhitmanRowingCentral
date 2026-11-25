# Whitman Erg Tracker

Training tracker for the Whitman girls rowing squad (pilot; boys and Pyle MS out of scope). Athletes log erg and on-your-own (OYO) work; the tool turns it into weighted training minutes, benchmark PRs, Gold Medal Standard (GMS) %, stars and attendance. Owner: David Noyes (Head Coach). Coaches: David, Forrest, Greta. David prefers clarifying questions before building.

**History and reasons:** the full, untrimmed rules with dates and PR-by-PR notes are in `erg-tracker/docs/history.md` (not auto-loaded; grep it by function name or date). Check it when a rule here needs its why. Newer entries there supersede older ones. When you add a rule, put the current rule here in a line or two and the story in history.md.

## Stack

- **Google Sheet** is the database; **Apps Script** (bound to the Sheet, source `apps-script/`) builds tabs, converts submissions, runs ErgBot/Logbook writes. The Google Form is no longer used by athletes (`/logworkout` still redirects).
- **Netlify site** `whitmanrowingcentral.netlify.app` (`site/`, see `site/README.md`). Functions read the Sheet through a private Apps Script web app feed (`apps-script/Feed.gs`, POST with `FEED_KEY`). A scheduled function copies the feed into Netlify Blobs every 5 minutes, so pages never wait on Apps Script.
- Secrets (FEED_KEY, Concept2, Slack) live in Netlify env vars only. Never commit them. No Claude artifacts for athlete-facing views (claude.ai is 18+). Athletes never get the Sheet.
- Sign-in: athletes name + password (birthday works once, then they set a 6+ character password; `lib/coachpw.mjs`). Coaches are added by the admin (`ADMIN_COACH` env, David) from Settings > Coaches, temp password forced to change. `liveSession()` in `lib/auth.mjs` re-checks every request. Sessions last 365 days.

## Rules that must never break

1. **Times are stored as seconds** (2:13.5 -> 133.5). Format only for display (`parseTime`/`formatTime`, `apps-script/Time.gs`).
2. **Store raw data, apply rules at display** (multipliers, GMS constants, OYO goals, star bands, validity checks), so retuning Settings recalculates history.
3. **Weight is coach-only.** Weights tab (hidden) only; never on a page athletes see, never in the feed, never phrased as a way to earn stars. A test fails if any athlete-facing text mentions weight. Birthday is coach-only too.
4. **Speed, not weight. Consistency and improvement, not just the fastest.**
5. Column headers in `apps-script/Config.gs` are the contract with the site: add at the end, never rename or reorder without updating every reader. Form question titles in `Q` are how answers are found.
6. The feed sends no weight, birthday, coach notes, Slack IDs, Roster notes or HR (tests check).
7. Neutral wording in site/ErgBot/Slack text (see `REVIEW.md`). The club is unaffiliated, not a school.
8. Dummy data only in tests (IDs A901+, clearly fake). No athlete data in the repo.

## Sheet tabs

Roster, Entries, Intervals, Benchmarks, Weights, Practices, Settings, Change log, Workouts, Schedule, Squad history, Races, Logbook raw (hidden). Columns: `docs/sheet-schema.md`.

- **Settings** are edited on the site (`#/settings`, coaches); field list is `apps-script/SettingsPage.gs`. Sheet-only keys: site.coaches, site.test_password, slack.coach_ids, alerts.email, form.*, backup.*, GMS constants, target.*, timezone. Retiring a key: add it to `RETIRED_SETTING_KEYS` in `Setup.gs`. Real dates live only in Settings.
- **Roster**: stable Athlete ID; `Active = No` keeps history. Squad Varsity / Novice / Alum (Alum shows only on All Time boards, out of plans, averages, team GMS). Role Coxswain signs in like an athlete but is not a rower (`activeRowers`): out of attendance, Insights, OYO ranking, boards, flags; on Week sees every rower's target, no results. Age group = age on Jan 1 (U15/U16/U17/U19). School year rolls **July 1** (`school_year_start` = 07-01) for season bests, stars, boards, team GMS.
- **Entries**: one row per session (Practice / OYO / Make-up), `Source` Form / Slack / Logbook / Site. Status stored as `Full`/`Modified`/`Missed`/`Out`; shown as **Completed**/Modified/Missed. Intervals: 1-10 per entry. Weights: each result uses the most recent weight on or before its date, else her latest overall.
- **Erg photos**: ~150 KB copy in one private Drive folder (`Photos.gs`), served only to the athlete who logged it and coaches via `/api/photo/:id`. A matching Logbook entry (same athlete/day, meters within 1%, time within 1.5%) wins and takes the photo.
- **Change log**: every manual edit and automatic marking (Who, cell, old, new).

## Scoring and weighting

- **Training minutes** = work + warm-up/cool-down. Rest never counts. Warm/cool count only on RowErg/BikeErg with average split faster than 3:00/500m (`WARMCOOL_MAX_SPLIT_S`, `site/lib/stats.mjs`), as Aerobic. Total meters = work + warm/cool meters; rest never.
- **Activity weights** (Settings, live): RowErg 1.0, BikeErg 1.0 (its meters count half, split shown with *, never a benchmark), Run 1.2, Stair 0.9, Swim 0.8, Elliptical 0.7, Bike 0.6, Other 0.6 (athlete Log activity only; needs a typed description, distance optional), Lifting 0 (no meters, no OYO minutes). An activity with no Settings row weighs 1.0 (old SkiErg rows).
- Modified counts as attended and gets its activity multiplier only (no extra penalty). Sessions tagged Aerobic / Threshold / Anaerobic by main set. Drag factor prefilled 105; a benchmark with none gets "FLAG: no drag factor".
- **OYO**: coach sets Standard (`oyo.standard.required`, 60); Elite = Standard x 2; Overreaching = 150%+ of Standard (Insights). No per-athlete groups. Break weeks (4+ Mon-Sun days in `oyo.break.dates`) are all OYO with `oyo.break.required/elite`. Weekends are OYO only (winter).
- **Load flag** (coaches): week more than `load.jump_pct` (15) above the average of the 3 prior weeks (`loadTrend`).
- **Benchmarks**: 100m, 500m, 2000m (time, lower better), 20' and 1' (meters, higher better; the 1' is one 1:00 piece, key `1min`, tagged Anaerobic, no GMS, stars, Plan target or Balance page; added 2026-11-24), 30r20 (valid if average rate <= 20, no GMS). Only 2k and 20' earn stars. Every test also writes an Entries row. **A test always has "test" in its title; a title with "warm" or "cool" is never a test** (`titleSaysTest`).
- **GMS** (`apps-script/Gms.gs`): 2k-equivalent split (20' split - 8.5s; 500m split / 0.895; 100m split / 0.786), T = split x 4, P = 0.75 x T x (W/270)^0.222, GMS % = 300 / P. **Stars** 1-5 by GMS % (Settings `gms.star2_pct..star5_pct`; defaults 95/96/97/100, lower edge inclusive); shown = average of best 2k and best 20' stars this school year. Stars are public; GMS % only to the athlete and coaches; GMS Rating tab coaches only. Next star shown as time (2k) or meters (20').
- **Team GMS**: averages only, no names/weights; best result per rower; groups under `team_gms.min_group` (3) hidden; only 2k/20'. **Regatta report** is coach-only (Sheet menu), never on the site.
- **Leaderboards**: School Year / All Time x All / Fr/Nov (7th-9th when the piece was done) / Varsity (10th-12th). One best per athlete; raw erg scores; stars next to names.
- **Targets** (`Plan.gs`): % of the athlete's season-best watts (watts = 2.80 / (split/500)^3). Aerobic bases on 20' first (`target.Aerobic.20min` 70-80), else 2k; a piece with no base test falls back to her other test; Sprint (Anaerobic) work never has a target. Threshold 75-80 (2k) / 95-100 (20') set 2026-11-23; Aerobic and Anaerobic ranges still PLACEHOLDER. No benchmark -> "No target yet" and a coach flag. Weight is never an input.

## Attendance and plan check (current rules, 2026-11-23)

- **Completed by default.** Any log in the practice window is Completed, even short of or different from the plan, even under half. A day with no log is absent and opens a make-up (within 7 days, same or coach-approved workout, counts fully as practice). Out = coach-set, 0 minutes, 5+ days out waives make-ups.
- The plan check (`PlanFlags.gs`) never changes Status itself: a short or different log sets Review status `Auto Modified` and posts one #ergbot-coaches message with **Mark Modified**, **Mark Missed** (only when under half was done) and **Keep Completed** (`plan_confirm`, `plan_missed`, `plan_full`). Only a coach marks Modified/Missed (also Attendance page > Change a mark, `AttendanceMark.gs`, Review `Reviewed, Coach`). Missed keeps its minutes but opens the make-up (`openMakeups_` ignores a Missed entry). Old rows already marked Modified/Missed still work with the same buttons. Athlete and Logbook DMs say it counts as Completed for now and coaches were told.
- **Whole-day judging** (`planJudgeWorkout_`): everything logged for a workout that day is pooled in order done; one alert covers the day; unfinished workouts wait until the day is over, a different workout is flagged at once. Steady work (every piece 5:00+) in another shape is complete at 98% (`PLAN_SHAPE_FRACTION`); short repeats never. Runs match at 90% of planned time/distance (`checkRunAgainstPlan_`).
- **Open workouts** (Plan page type Open, "60' of work in any format"): one target in counted time; every Practice entry that day counts work time x activity multiplier (`planOpenCountedS_`); 100%+ Completed, under it a coach-decision candidate, under half Missed candidate; judged once per athlete and day after the day ends; 1 s slack; never moved to OYO.
- **Several workouts a day**: each entry matches the workout it fits (`plannedBest`, `planFitScore_`, order by `Submitted at`); a published workout with nothing logged shows "Not done" once the day is over. Warm-up/cool-down are never flagged Modified (only if it is the only thing logged); a poor guess ("closest: X, N%") still flags. Extra work (15:00+ extra Practice entry beyond the plan) becomes OYO quietly (`planExtras`, `moveExtrasToOyo_`, 15-minute sweep).
- Three or more "Not logged" flags in one sweep post as one summary (`PLAN_BATCH_MIN`). `site/tests/photo.mjs` lists real PM5 titles seen; add new ones.

## Logging paths

- **Logbook (Concept2)**: webhook + 15-minute poll fetch each result with the athlete's own token (`site/lib/logbook-sync.mjs`, 3-day window). A result counts at once with no Review status; only a possible make-up and a 2k/20'-shaped result (needs "test" in title) stay Pending. A test-shaped result no longer DMs the athlete: one line to #ergbot-coaches, becomes a normal workout after 24 h (`LOGBOOK_AUTO_ACCEPT_HOURS`); possible make-ups DM the athlete and wait for a tap. One piece under 2:00 is ignored (`logbookTinyResult_`); a 100 m test and multi-piece results are kept. Classification: no practice that day -> OYO; practice inside window -> Practice; matches a missed practice within 7 days -> Possible make-up. `practiceForSquad_` (`Logbook.gs`): only Varsity/Novice Practices rows are squad-limited; Girls/All/blank is everyone.
- **ErgBot photos** (Slack DM, up to 4 per message, `MAX_PHOTOS`): date taken from the screen; more than 14 days off asks first. Practice day -> Practice; any other day (weekends too) -> OYO unless an open make-up (then asks). Exact 2000 m / 20:00 with "test" in title asks "Was it a test?". Rows that don't add up save from the total row with "Check this one". Slack `/log` has a Test type. Odd time/distance asks "Fix it / It is right, save it" (`site/lib/plausible.mjs`). Mistyped names get "Did you mean X?" (`nearNames`). Test prompts go to coaches and expire after 24 h.
- **Site**: athletes use Log activity (`#/logrun`, non-erg only, self only, date within 14 days, one activity at a time); coaches use Log for an athlete (`#/log`, `site-log`). Erg work goes through ErgBot and Logbook.
- **ErgBot questions**: DM or @ErgBot in the coaches' channel; a small model picks a lookup from `site/lib/asklookups.mjs`, code writes the reply; athlete access is off until `ERGBOT_ATHLETE_QUESTIONS=on` and is limited by Slack ID in code. Coach free-form answers use `askfree.mjs` (capped per question and month). Weights are never shown by a lookup.

## Team site

- Pages: sign-in, Team, athlete pages, boards, GMS Rating (coaches), Attendance, OYO, Week (coming week Mon-Sat; athlete sees own targets and results, coaches see per-workout squad results, can open `#/week/ID`), My workouts, Insights (own page + coaches; coach tab flags Missed 2+ in 28 days, overreaching, attendance under 80%, missing tests, Logbook not connected from Dec 1), Balance (coaches only, 2k as anchor), Lineups (coaches, boat names shared via `/api/lineup-names`), Plan workouts (coaches, `#/plan`, `WorkoutBuilder.gs`, saved or one-off workouts, Order column), Weights page, Settings, Coaches, Athlete passwords.
- Athletes see a teammate's sessions, make-ups, attendance and tests; never their GMS %, insights, pacing, Today card or workout detail. Display names: first name, plus last initial on clashes (`site/lib/names.mjs`).
- Practice schedule: Early 3:30-5:30 (Mon, Wed, even-date Fri), Late 5:00-7:00 (Tue, Thu, odd-date Fri); Practices tab generated from Settings.
- UI: side nav (hamburger under 720px), dark default, blue accent, home-screen name "Whitman Rowing", Back stack (`backstack.mjs`). **No sideways scrolling on any athlete page**; coach-only wide tables are listed in `site/tests/browser/known-scroll.json`; any new sideways scroll needs David's go. New public files go in `sw.js` SHELL and bump `CACHE`.
- Alerts and backups (`Ops.gs`): hourly site health check to Slack/email, Sunday Sheet backup to Drive (keep 12), New school year menu never deletes data. After a push that adds scopes run **Turn on alerts and backups**.

## Out of scope by decision

Wellness check-ins, menstrual tracking, visible weight anywhere, XBoat, excused/unexcused attendance, RPE questions (stored RPE stays), Strava/Apple Health sync, a multi-row Log activity form.

## Working in this repo

- **Verify before every commit**: `node erg-tracker/tests/run.js && node erg-tracker/site/tests/run.mjs` (run `npm install` once). If you changed `site/public/` pages or CSS also `node erg-tracker/site/tests/browser/run.mjs`. Keep new Apps Script logic in pure functions with a test in `tests/run.js` (Sheet/Form/Slack calls have no automated check).
- **One open PR**: if any PR is unmerged, new fixes go on its branch. Merge only on David's go. Batch a session's work into one PR (every merge is a Netlify build; deploy previews are off; `netlify.toml` skips builds when nothing under `erg-tracker/site/` changed).
- **Apps Script pushes**: Apps Script deploys automatically on merge to main via a GitHub Action. **Never `clasp deploy`** (new deployment); only `update-deployment` of the "Team site feed" version, and only after David's clear go in any thread (applies to Apps Script only, not the Netlify deploy). Before any manual push check the branch contains main (`git merge-base --is-ancestor origin/main HEAD`). After changing `Feed.gs` or anything it calls the web app needs a new version.
- Changes that add Sheet columns or dropdown values need **Erg Tracker > Set up Sheet and Form** after the merge; say so in the PR. If the site calls a new Sheet action, Apps Script must be pushed before the site PR merges.
- Local preview tool: `plans/local-preview-how-to.md`. Dummy data: `apps-script/Dummy.gs` (menu Load/Clear dummy data; IDs A901+, `DUMMY` marks).
- Three failed attempts at the same failure: stop and ask David. Never skip or loosen a test to get green.
