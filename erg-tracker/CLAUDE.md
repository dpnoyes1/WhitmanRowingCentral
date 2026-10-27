# Whitman Erg Tracker

Training tracker for the Whitman girls rowing squad (pilot; boys and Pyle MS are out of scope for now). Athletes log erg and on-your-own (OYO) work. The tool turns it into weighted training minutes, benchmark PRs, Gold Medal Standard (GMS) %, stars and completion rates.

Owner: David Noyes (Head Coach). Coaches: David, Forrest, Greta. David prefers clarifying questions before building.

## Stack

- **Google Sheet** is the database. **Google Form** is manual entry. **Apps Script** (bound to the Sheet, source in `apps-script/`) builds the tabs and Form and converts submissions.
- **Netlify site** `whitmanrowingcentral.netlify.app` (source in `site/`, see `site/README.md`) serves dashboards. Netlify Functions check the password and read the Sheet through a private Apps Script web app feed (`apps-script/Feed.gs`, POST with `FEED_KEY`). A scheduled function (`site/functions/refresh-feed.mjs`, production only) copies the feed into Netlify Blobs every 5 minutes, so page loads never wait on Apps Script (David, 2026-10-23).
- Team password and coach password live in Netlify environment variables only. Never commit them. Rotate each season.
- Athletes never get access to the Sheet itself. Only coaches do.
- No Claude artifacts for athlete-facing views (claude.ai accounts are 18+).

## Rules that must never break

1. **Times are stored as seconds** (2:13.5 -> 133.5, rounded to tenths). Format as m:ss.0 only for display. Use `parseTime` / `formatTime` in `apps-script/Time.gs`. Never write formatted time text into a data tab.
2. **Store raw data, apply rules at display.** Activity multipliers, GMS constants, OYO targets, star bands and validity checks (e.g. 30r20 rate cap) are applied when reading, never baked into stored rows, so retuning Settings recalculates history.
3. **Weight is coach-only.** It lives only in the Weights tab (hidden). It is never on the Form, never sent to the team view, never shown to athletes, and never phrased as a way to earn stars ("lose weight" / "at X lb you'd have..." is forbidden). Athlete-facing gaps are time, split or meters only. A test in `tests/run.js` fails if the Form mentions weight.
4. **Speed, not weight. Consistency and improvement, not just the fastest.**
5. Column headers in `apps-script/Config.gs` are the contract with the site. Add columns at the end; never rename or reorder without updating every reader.
6. Form question titles in `Q` (Config.gs) are how answers are found. Rename them in code and rebuild the form, never only in the Form editor. Titles must be unique across the whole form.

## Sheet tabs

Roster, Entries, Intervals, Benchmarks, Weights, Practices, Settings, Change log, Workouts, Schedule, Squad history, Races (coach-only). Full column list in `docs/sheet-schema.md`.

- Roster: one row per athlete, stable `Athlete ID` (A001...) auto-assigned. `Active = No` keeps history but drops them from the form. Role Coxswain appears in "Entered by" but not "Athlete".
  - Profile (decided 2026-10-23): coaches type `Birthday` and `Grad year`. `Age group` and `School year` are array formulas in their header cells (see `apps-script/Profile.gs`, which has matching JS). Age group = age on **Jan 1** of the current year: under 15 U15, 15 U16, 16 U17, 17+ U19 (17 on Jan 1 is not U17). School year rolls over **July 1**; Class of G is 12th in the school year ending June G; 7th-12th (Pyle MS included), "Graduated" after. For coach reference only for now.
  - **Birthday is coach-only** like weight: the date never leaves the Sheet. Since 2026-10-23 it is also each athlete's site password; the feed sends only a keyed HMAC of it (`logins`), which stays on Netlify's server.
- Entries: one row per session (Practice / OYO / Make-up). `Source` is Form now; Slack and Logbook later.
- Intervals: 1 to 10 per entry, linked by Entry ID.
- Weights: history; each result uses the most recent weight on or before its test date.
- Change log: every manual edit to data tabs (who, cell, old, new) plus submit errors.

## Volume and weighting

- Training minutes (headline) = warmup + work + rest + cooldown. Work minutes = main set only.
- Total meters include rest meters. Rest never counts toward performance scoring.
- Lifting (David, 2026-10-23): no meters and no OYO minutes (multiplier 0, and `meterTotal` in `site/lib/stats.mjs` counts 0 meters). The Form's Work meters allows 0 so a lifting session logs with 0. Warmup is not static day to day, so the Form no longer prefills it (only drag factor 105 is prefilled); `refreshFormQuestions_` updates the live Form in place when Set up Sheet and Form is run.
- Multipliers apply to practice and OYO: Run 1.2, RowErg 1.0, SkiErg 1.0, Stair stepper 0.9, BikeErg 1.0 (counts like RowErg, David 2026-10-23), Swim 0.8, Elliptical 0.7, Bike (road or stationary) 0.6, Hike 0.3, Walk 0.1, Lifting 0. Editable in Settings.
- Modified practice (alternative activity, or cut short / DNF with only the completed work logged) counts as complete. No extra minutes multiplier (David, 2026-10-23): it gets its activity multiplier like any session, and less work already means fewer minutes.
- Load trend (David, 2026-10-23): weekly weighted minutes per athlete. Coaches see a flag when a week is more than Settings `load.jump_pct` (15) above the average of the 3 weeks before; in her first weeks the average uses the weeks since her first session (her first week is never flagged). `loadTrend` in `site/lib/stats.mjs`. The old `spike_threshold_pct` row is unused.
- Effort: no new Form question (no soreness; wellness stays out of scope). The site charts weekly average Session RPE, weighted by training minutes.
- Every session tagged UT2 / UT1 / AT / AN by main set. HR optional. Drag factor is prefilled at 105 on the share link. It is required on both test pages and optional on the Finish page (David, 2026-10-25). A benchmark with no drag factor gets "FLAG: no drag factor" in its Drag check column and a Change log note; Slack alerts to the athlete and coach come later.

## OYO goals

Weekly weighted minutes. Standard group Required 60 / Elite 120. Performance group per-athlete (placeholder 90/180; Roster overrides). Missing Required counts against completion. Minutes above Elite show in totals but earn no extra recognition. OYO goal progress is public.

Break weeks (David, 2026-10-23): the one winter break (Christmas) has no practices or scheduled workouts, so everything is OYO. Settings `oyo.break.dates` holds the range(s) and `oyo.break.required` / `oyo.break.elite` the goals for everyone in a break week (blank = her usual goal). A Mon-Sun week with 4+ break days is a break week (`isBreakWeek` / `oyoGoals` in `site/lib/stats.mjs`). Real dates go in Settings only.

## School year (David, 2026-10-25)

One rollover date for everything: **July 1** (Settings `school_year_start` = `07-01`; code defaults match). Season bests, stars, boards, team GMS years, the My workouts year filter and the new-school-year rollover all use it. The live Sheet's Settings cell must be changed to `07-01` once by David; existing data needs no change.

## Benchmarks, GMS and stars

| Test | Score | Better | GMS % | Stars |
|---|---|---|---|---|
| 100m | time | lower | yes | no |
| 500m | time | lower | yes | no |
| 2000m | time | lower | yes | yes |
| 20' (`20min`) | meters | higher | yes | yes |
| 30r20 | meters | higher | no (intentional) | no |

30r20 is valid when **average** rate <= 20.

Every benchmark test also counts as a session (decided 2026-10-22): it writes a Benchmarks row and an Entries row (Practice or OYO, with warmup, cooldown and RPE) plus one Intervals row, linked both ways by `Entry ID` / `Benchmark ID`. Default zones per test (100m/500m/2000m AN, 20' AT, 30r20 UT1) are an assumption in `BENCHMARK_TESTS`.

GMS math (implemented in `apps-script/Gms.gs`, tested against the planning example):
1. 2k-equivalent split: 20' split - 8.5s; 500m split / 0.895; 100m split (time x 5) / 0.786. T = split x 4.
2. Predicted 1500m 8+ time: P = 0.75 x T x (W / 270)^0.222.
3. GMS % = 300 / P (always vs 1v8 standard 5:00).
4. Stars, 1 to 5 by GMS % (David, 2026-10-23): any valid 2k or 20' earns 1 star; 2 stars at 95%, 3 at 96%, 4 at 97%, 5 at 100% or better. A band's lower edge is in it. Settings `gms.star2_pct`..`star5_pct`.
5. Next star shown as time only, e.g. "next star: 2.2s faster on your 2k (7:42.8, ~0.6s/500m)". 20' gap as split/meters.
An athlete's season stars on the site are the average of her best 2k and best 20' stars this school year, so half stars happen (David, 2026-10-23; one test only: that test's stars). They show next to names on Athletes, Leaderboards and athlete pages. Stars are public; GMS % is visible to each athlete. Novices use the same standards.

## Team GMS view

Team-wide, Varsity, Novice and rank band (1-8, 9-16, 17+) averages of GMS % (decided 2026-10-22). Logic in `apps-script/TeamGms.gs`; coach tab via menu "Team GMS report".
- Only 2k and 20' count. Each rower counts once with her best GMS % in the window; tests without a weight on or before them are left out of averages.
- Rank bands are team-wide by raw erg (best 2k-equivalent time, no weight), not boat placement.
- Years compare school year to date (same number of days after Jul 1), not by test week. Past full years shown on the coach tab for reference.
- Past-year squads come from Squad history ("Save squads for this school year" each season); missing rows fall back to Roster.
- Team site gets `teamGmsForSite`: averages only, no names, ranks or weights. A group with fewer than `team_gms.min_group` (3) rowers shows no average.

## Regatta view (coach-only)

Compares erg standards with racing, e.g. the Stotesbury V8 year to year (decided 2026-10-22). Logic in `apps-script/Regatta.gs`; menu "Regatta report".
- Races tab, one row per race: Date, Regatta, Championship (checkbox), Event, Boat (8+ / 4+), Round, Time, Place, 1st/2nd/3rd times, Seat 1 (bow) to Seat 8 (stroke), Cox. Times typed as m:ss and parsed when read. 4+ uses Seats 1-4.
- Each rower's best 2k and best 20' in the school year up to race day, shown separately as raw averages and GMS %. Cox never counts.
- Racing is compared by % off the winner (negative = winning margin over 2nd) and % off 3rd, not GMS predicted time: that only holds on flat water with no wind.
- Never sent to the team site.

## Schedule and classification (girls, winter)

| Shift | Time | Days | Window |
|---|---|---|---|
| Early | 3:30-5:30 pm | Mon, Wed, even-date Fri | 3:00-6:00 |
| Late | 5:00-7:00 pm | Tue, Thu, odd-date Fri | 4:30-7:30 |

Even/odd is the calendar date. No winter weekend practice. Practices tab is generated from Settings (`generatePracticeSchedule`); canceled days are marked by hand.

Auto-classification (phase 2, Logbook sync): no practice that day -> OYO; practice day inside window -> Practice; outside -> OYO; matches a missed practice within 7 days -> Possible make-up (stays pending until tapped); BikeErg/SkiErg set from machine; unchanged labels auto-accept after 48 h.

## Weekly plan and targets

- Coaches build workouts in the **Workouts** tab (one row per piece; Reps for repeats; one row per piece for variable intervals; `Start every` or Rest = Undefined for common-start sets) and assign them by date and squad in **Schedule**. Only Published rows reach athletes.
- Erg targets = % of the athlete's **season-best** 2k or 20' **watts** (school year; falls back to last season only). Watts = 2.80 / (split/500)^3. UT2/UT1 show a range, AT/AN a single number; zone defaults in Settings `target.*` are PLACEHOLDERS for David to tune.
- No benchmark -> no target shown, and the athlete is flagged to coaches (Slack alert in phase 2).
- Targets are visible to the whole squad (no per-athlete privacy, by decision).
- Logged sessions and make-ups are checked against the planned workout at display (`checkAgainstPlan`); make-ups use the missed day's plan. Never stored.
- Logic in `apps-script/Plan.gs` (pure, portable); Sheet reports in `PlanSheet.gs`. `weekPlanForSite` is the payload shape for the athlete site.
- Weight is never an input to targets.

## Availability and make-ups

Statuses Full / Modified / Out. No excused vs unexcused: any miss counts. 5+ consecutive days out -> return-to-training flag, ramp-back week, make-ups waived. Make-ups within 7 days, same or coach-approved workout, count fully, minutes count as practice not OYO.

## Leaderboards

One per benchmark; toggles School Year (starts Aug 1) / All Time and All / Fr/Nov / Varsity. Fr/Nov (shown as "Fr/Nov", David 2026-10-25) = 7th-9th grade and Varsity = 10th-12th **when the piece was done**, from Grad year and the piece's date, so a freshman record stays frozen after she moves up and her later pieces count on Varsity (David, 2026-10-25; replaces the Varsity/Novice squad toggle, no squad history involved). One best per athlete per board; All is her single best. Rows with no Grad year show under All only. Raw erg scores only; columns are result, split, stroke rate and date, and each name carries her season stars (David, 2026-10-23). All Time keeps graduated athletes; the "alum" tag means Grad year before this school year (not Active = No). Rows with Source containing "import" (Record Board import, 2026-10-25) show the school year instead of the placeholder date. Needs feed version with `gradYear` on athletes and `dateApprox` on benchmarks.

## Team site (decided 2026-10-23)

- Sign-in (David, 2026-10-23): an athlete types her first and last name and her birthday as the password (the field never says "birthday"; any common date format works). `lib/auth.mjs` checks it against the feed's `logins` codes (HMAC-SHA256 with FEED_KEY of `login:<id>:<YYYY-MM-DD>`, made by `feedLoginSigner_` in `Feed.gs`), and the session cookie carries her athlete ID. Coaches sign in the same way from Settings `site.coaches` ("First Last MM/DD/YYYY; ..."; code keyed `coach:<name>`) and see everything, GMS % and every athlete's targets included (David, 2026-10-23); TEAM_PASSWORD with no name is their fallback. While Settings `site.test_password` holds a date, every athlete signs in with it instead of her birthday (David's interim choice, 2026-10-23). An athlete with no Birthday on the Roster cannot sign in once it is cleared. Real dates live only in the Sheet, never in the repo.
- Full names on the site. Data refreshes every 5 minutes.
- Short links (David, 2026-10-23): `/logworkout` goes to the athletes' Google Form (forms.gle link) and `/guide` goes to David's logging guide Google Doc. Both are 302 redirects in the root `netlify.toml`, linked from the sign-in page, the menu and the Today card. Change the target there if the Form or Doc moves. ErgData and Concept2 syncing come later.
- Sign-in lasts 365 days, and the browser remembers who is signed in so pages open without a session check first (David, 2026-10-23: athletes rarely share devices, security matters little here).
- The feed (`siteFeed` in `Feed.gs`) sends no weight, birthdays, coach notes (Out notes can be medical), Slack IDs, Roster notes or HR. GMS %, stars and next-star gaps are computed in the Sheet. Tests in `tests/run.js` check this.
- GMS % goes only to the signed-in athlete for her own page and to coaches (team session), enforced by `/api/athlete/:id`; teammates get stars only. Coaches also see each athlete's Today card and can open any athlete's week at `#/week/ID`. Stars next to names are public; the Stars ranking tab and `/api/stars` are coaches only (David, 2026-10-23). The team view shows GMS averages only (`teamGmsForSite`).
- Weighted minutes are computed in `site/lib/stats.mjs`. Modified sessions use their activity multiplier only (no `modified_multiplier`; removed 2026-10-23). Make-ups count as practice minutes. Today's practice counts toward completion only once logged.
- Week ahead (layer 3, David 2026-10-23): **Week** tab shows only the coming week, Monday to Saturday (this week through Saturday, next week from Sunday), her squad's sessions and only her own targets. Her own page has a **Today** card with today's targets. No 2k or 20' yet: she sees "No target yet: do a 2k or 20' to get one." and coaches see the FLAG row in the Sheet's plan report (coach view and Slack later). Results vs goal (David, 2026-10-23): once logged, each session shows her splits per piece against her target (✓ in range, ↓ under, ↑ over; same rule as the Sheet's Plan check), and past sessions she didn't log say "Not logged". An athlete sees only her own results. Coaches see everyone in the session's squad (logged or not) in a fold-out under each workout, can open any athlete's week, and can look back one week (`#/week/prev`, `?week=prev`). The feed's `weeks` covers last, this and next week; each session carries `results` from `feedWeekResults_` in `Feed.gs`. Benchmark tests are scored, not ranged. BikeErg (David, 2026-10-23): same monitor, double the distance, so its meters count as half (`rowEquivalentIntervals` in `Plan.gs`; 2:00/1000m bike = 2:00/500m row = 202.5 W); its split shows with a * and is ranged against the RowErg target, and it never counts as a benchmark. Other machines show no split or range.
- My workouts (David, 2026-10-25): on her own page (and coaches' view of her), her logged workouts filtered by zone tag (UT2, UT1, AT, AN) and by This school year / All. Each opens to its totals and, for this school year only, each interval's split against the target that stood on the planned date (`/api/workout/:id`, `feedLogged_` in `Feed.gs`). Teammates get no list and no splits.
- Insights (David, 2026-10-23): her own page and coaches only (teammates get none; `/api/athlete/:id` sets `insights` to null): RPE by week, steady-state (UT2/UT1 RowErg, BikeErg at half meters) split by week with a faster/slower trend, 2k and 20' this school year with the change from the last one, an estimated 2k from a 20' newer than her last 2k (8.5 s rule), and this month's practices logged (make-ups count) with her streak. The load flag and trailing average are coaches only. Coaches get an **Insights** tab (`/api/insights`) with every rower, flagged first. No public consistency ranking.
- Built in layers, one PR each: (1) password gate, team dashboard, athlete pages; (2) leaderboards, stars and GMS, OYO board, team GMS averages; (3) week ahead with targets (`weeks` in the feed). Coach view after.
- Deploy previews require a Netlify login. Production needs a site sign-in.

## Alerts, backups and new school year (David, 2026-10-23)

Logic in `apps-script/Ops.gs`, guide in `docs/SETUP.md` Parts C and D.
- **Alerts:** hourly trigger `checkSiteHealth` loads Settings `site.url` and POSTs `/api/health` (`site/functions/health.mjs`, keyed with FEED_KEY, counts only). One alert when it breaks, a daily reminder while broken, one on recovery; failed form submissions alert too (no athlete details). Slack incoming webhook (Script Property `SLACK_ALERT_WEBHOOK`, menu **Slack alerts webhook**) when set, else email to `alerts.email` (blank: Sheet owner). David wants Slack later, when standing up real athletes; email until then.
- **Backups:** Sunday 23:00 trigger `backupSheet`: values-only copy of every tab (not `makeCopy`, which would copy the linked Form) into Drive "Erg tracker backups" (`backup.folder_id`), newest `backup.keep` (12) kept.
- **New school year** (menu): never deletes data (David). Archive copy (never trashed), `saveSquads_` for the closing year, Active = No for Grad year <= that year's seniors, logged in Change log. Results, stars and boards already reset by `school_year_start`.
- These add OAuth scopes (Drive, external fetch, email, triggers). After pushing, run **Turn on alerts and backups** in the Sheet to authorize, or the form submit trigger stops.

## Phases

1. Pilot: Sheet + Form + Apps Script (this repo now), then Netlify dashboards (team, athlete, coach) with GMS, stars and passwords.
2. Concept2 Logbook API sync and Slack bot (group DM per athlete with the three coaches; confirmation cards; Friday OYO progress; coach digest). Slack button clicks go to a Netlify Function (3 s reply limit). **Slack entry**: a `/log` command opening a Slack modal that writes the same Entries/Intervals rows with `Source = Slack`; reuse `parseSubmission`.
   - **Plan mismatch DM to coaches** (David, 2026-10-23): when a session marked Full doesn't match its plan (e.g. 5 of 8 logged without Modified; `planFlag` in `Plan.gs`), message David in Slack with a button that sets Status to Modified (logged in Change log) and a link to edit the entry in depth. Until then the flag shows in the Plan check tab's Flag column.
3. Photo of PM5, Strava, season required rate, past-season import, boys and Pyle MS.

## Open questions

- Performance default targets (placeholder 90/180).
- Rewards for milestones and Elite. Team shoutouts in Slack.

## Out of scope by decision

Wellness check-ins, menstrual tracking, visible weight anywhere, XBoat, excused/unexcused attendance.

## Working in this repo

- Apps Script source: `apps-script/*.gs`. Paste into the Sheet's Extensions > Apps Script, or push with `clasp` (see `docs/SETUP.md`).
- Tests: `node erg-tracker/tests/run.js` (no dependencies). Run before every commit. Keep pure logic (parsing, GMS, schedule) free of Sheet/Form calls so it stays testable and portable to the Netlify site.
- Site tests: `node erg-tracker/site/tests/run.mjs` (uses the dummy feed from `site/scripts/dummy-feed.js`). Netlify runs both suites as its build command.
- Netlify deploy credits (David, 2026-10-23): batch a session's work into one PR and merge once, not a PR per item; every PR preview and every merge is a build. `netlify.toml` `ignore` skips every deploy preview (David turned them off) and skips production builds when nothing under `erg-tracker/site/` or `netlify.toml` changed (Apps Script-only changes don't build). So test locally (both suites plus the dev server) before merging; the first live check is after the merge.
- Publishing My workouts (David, 2026-10-25): `Feed.gs` must go to the Sheet in the same publish (clasp push of all `apps-script/` files), then the Team site feed needs a new web app version, or the splits don't reach the site. The school-year Settings change (`school_year_start` = `07-01`) is already done in the Sheet.
- After changing `Feed.gs` or anything it calls, the Apps Script web app needs a new version (Deploy > Manage deployments > edit > New version), not only a clasp push.
- Dummy data (decided 2026-10-23): `apps-script/Dummy.gs`, menu **Load dummy data** / **Clear dummy data**. 30 made-up athletes (4 each 7th-9th novices, 6 each 10th-12th varsity), practices Oct 5-23 2026 plus a planned week Oct 26-30, OYO, make-ups, weights, and three rounds of 2k and 20' (late Aug, Sep, Oct); not everyone improves every round. Seeded, so it is the same each load. Marks: Athlete IDs A901+, Roster Notes / Weights Note start `DUMMY`, Source `Dummy`, IDs contain `-DUMMY-`, Workout IDs start `DUMMY-`. David will clear it all before adding real athletes.
