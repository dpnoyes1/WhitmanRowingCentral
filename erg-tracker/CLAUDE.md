# Whitman Erg Tracker

Training tracker for the Whitman girls rowing squad (pilot; boys and Pyle MS are out of scope for now). Athletes log erg and on-your-own (OYO) work. The tool turns it into weighted training minutes, benchmark PRs, Gold Medal Standard (GMS) %, stars and completion rates.

Owner: David Noyes (Head Coach). Coaches: David, Forrest, Greta. David prefers clarifying questions before building.

## Stack

- **Google Sheet** is the database. **Google Form** is manual entry. **Apps Script** (bound to the Sheet, source in `apps-script/`) builds the tabs and Form and converts submissions.
- **Netlify site** (not built yet) serves dashboards. Netlify Functions read the Sheet and check passwords.
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

Roster, Entries, Intervals, Benchmarks, Weights, Practices, Settings, Change log, Workouts, Schedule. Full column list in `docs/sheet-schema.md`.

- Roster: one row per athlete, stable `Athlete ID` (A001...) auto-assigned. `Active = No` keeps history but drops them from the form. Role Coxswain appears in "Entered by" but not "Athlete".
  - Profile (decided 2026-10-23): coaches type `Birthday` and `Grad year`. `Age group` and `School year` are array formulas in their header cells (see `apps-script/Profile.gs`, which has matching JS). Age group = age on **Jan 1** of the current year: under 15 U15, 15 U16, 16 U17, 17+ U19 (17 on Jan 1 is not U17). School year rolls over **July 1**; Class of G is 12th in the school year ending June G; 7th-12th (Pyle MS included), "Graduated" after. For coach reference only for now.
  - **Birthday is coach-only** like weight: never send it to the team site.
- Entries: one row per session (Practice / OYO / Make-up). `Source` is Form now; Slack and Logbook later.
- Intervals: 1 to 10 per entry, linked by Entry ID.
- Weights: history; each result uses the most recent weight on or before its test date.
- Change log: every manual edit to data tabs (who, cell, old, new) plus submit errors.

## Volume and weighting

- Training minutes (headline) = warmup + work + rest + cooldown. Work minutes = main set only.
- Total meters include rest meters. Rest never counts toward performance scoring.
- Multipliers apply to practice and OYO: Run 1.2, RowErg 1.0, SkiErg 1.0, Stair stepper 0.9, Swim 0.8, Elliptical 0.7, Bike/BikeErg 0.6, Hike 0.3, Walk 0.1, Lifting 0. Editable in Settings.
- Modified practice counts as complete; minutes weighted 0.6.
- Load = session RPE (1-10) x minutes. Spike flag placeholder: +30% vs 4-week average (not confirmed).
- Every session tagged UT2 / UT1 / AT / AN by main set. HR optional. Drag factor default 105; flag anything else for coaches.

## OYO goals

Weekly weighted minutes. Standard group Required 60 / Elite 120. Performance group per-athlete (placeholder 90/180; Roster overrides). Missing Required counts against completion. Minutes above Elite show in totals but earn no extra recognition. OYO goal progress is public.

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
4. Stars: 1 star P <= 5:30 (3v/Fr8), 2 stars P <= 5:15 (2v8), 3 stars P <= 5:00 (1v8).
5. Next star shown as time only, e.g. "next star: 2.2s faster on your 2k (7:42.8, ~0.6s/500m)". 20' gap as split/meters.
Stars are public; GMS % is visible to each athlete. Novices use the same standards.

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

One per benchmark; toggles School Year (starts Aug 1) / All Time and All / Varsity / Novice. Squad view shows both ranks ("#1 Jane Smith (#4 overall)"). Raw erg scores only. All Time keeps graduated athletes.

## Phases

1. Pilot: Sheet + Form + Apps Script (this repo now), then Netlify dashboards (team, athlete, coach) with GMS, stars and passwords.
2. Concept2 Logbook API sync and Slack bot (group DM per athlete with the three coaches; confirmation cards; Friday OYO progress; coach digest). Slack button clicks go to a Netlify Function (3 s reply limit). **Slack entry**: a `/log` command opening a Slack modal that writes the same Entries/Intervals rows with `Source = Slack`; reuse `parseSubmission`.
3. Photo of PM5, Strava, season required rate, past-season import, boys and Pyle MS.

## Open questions

- Spike threshold (placeholder +30%). Performance default targets (placeholder 90/180).
- Rewards for milestones and Elite. Team shoutouts in Slack.

## Out of scope by decision

Wellness check-ins, menstrual tracking, visible weight anywhere, XBoat, excused/unexcused attendance.

## Working in this repo

- Apps Script source: `apps-script/*.gs`. Paste into the Sheet's Extensions > Apps Script, or push with `clasp` (see `docs/SETUP.md`).
- Tests: `node erg-tracker/tests/run.js` (no dependencies). Run before every commit. Keep pure logic (parsing, GMS, schedule) free of Sheet/Form calls so it stays testable and portable to the Netlify site.
- Dummy data (decided 2026-10-23): `apps-script/Dummy.gs`, menu **Load dummy data** / **Clear dummy data**. 30 made-up athletes (4 each 7th-9th novices, 6 each 10th-12th varsity), practices Oct 5-23 2026 plus a planned week Oct 26-30, OYO, make-ups, weights, and three rounds of 2k and 20' (late Aug, Sep, Oct); not everyone improves every round. Seeded, so it is the same each load. Marks: Athlete IDs A901+, Roster Notes / Weights Note start `DUMMY`, Source `Dummy`, IDs contain `-DUMMY-`, Workout IDs start `DUMMY-`. David will clear it all before adding real athletes.
