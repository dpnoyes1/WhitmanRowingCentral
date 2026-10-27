# Sheet schema

Source of truth is `HEADERS` in `apps-script/Config.gs`. Times are seconds (`… s`), distances are meters (`… m`).

## Roster
| Column | Notes |
|---|---|
| Athlete ID | A001… auto-assigned, never reused |
| Name | Must be unique; this is what the Form shows |
| Slack member ID | For phase 2 group DMs |
| Squad | Varsity / Novice |
| Role | Rower / Coxswain (coxswains only in "Entered by") |
| OYO group | Standard / Performance |
| OYO required min, OYO elite min | Per-athlete override; blank = group default from Settings |
| Active | Yes / No |
| Notes | |
| Birthday | Typed by coaches. Coach-only, never on the team site |
| Grad year | Typed by coaches, e.g. 2029 |
| Age group | Calculated: U15 / U16 / U17 / U19 by age on Jan 1 of this year. Don't type here |
| School year | Calculated: 7th-12th or Graduated, rolls over July 1. Don't type here |

## Entries (one row per session)
Entry ID, Submitted at, Date, Athlete ID, Athlete, Entered by, Session type (Practice / OYO / Make-up), Make-up for date, Status (Full / Modified / Out; practice and make-up only), Activity, Warmup s, Work s, Rest s, Cooldown s, Work m, Rest m, Main set, Zone (Aerobic / Threshold / Anaerobic), RPE (1-10), Avg HR, Drag factor, Intervals (count), Coach note, Source (Form / Slack / Logbook), Review status, Response ID, Benchmark ID (set when the session was a benchmark test), Warmup m, Cooldown m (optional meters; blank if not known; added 2026-10-25).

Work s / Rest s / Work m / Rest m are sums of the Intervals rows, stored for convenience. Weighted minutes are never stored. Rest is stored but never counts toward minutes or total meters.

## Intervals
Entry ID, Interval #, Work s, Work m, Avg rate, Rest s, Rest m.

## Benchmarks
Benchmark ID, Submitted at, Date, Athlete ID, Athlete, Entered by, Test (100m / 500m / 2000m / 20min / 30r20), Time s (timed tests), Meters (distance tests), Avg rate, Drag factor, Splits s (comma separated seconds), Coach note, Source, Review status, Response ID, Entry ID (the matching session in Entries), Drag check (coach flag: "FLAG: no drag factor" when a test has no drag factor).

30r20 validity (avg rate <= 20) and GMS are computed at display, not stored.

## Weights (hidden, coach-only)
Date, Athlete ID, Athlete, Weight lb, Entered by, Note.

## Practices
Date, Squad, Shift (Early / Late), Start, End, Window start, Window end (text HH:MM), Status (Scheduled / Canceled), Planned workout, Notes.

## Workouts (coach-typed library, one row per piece)
| Column | Notes |
|---|---|
| Workout ID | Rows sharing an ID are one workout |
| Name | Shown to athletes; first piece's name is used |
| Piece # | Order within the workout |
| Reps | Blank = 1 |
| Work type | Time / Distance |
| Work | m:ss for Time (20:00), meters for Distance (500 or 500m) |
| Rest | m:ss, blank, or Undefined |
| Start every | m:ss send-off for common starts (8 x 500m every 3:30). Rest is then treated as undefined |
| Activity | Defaults to Erg (RowErg); only RowErg gets watts targets |
| Zone | Aerobic / Threshold / Anaerobic |
| Base | 2k / 20'. Blank = Settings `target.default_base` |
| Target low %, Target high % | % of season-best watts on the base. Blank = zone default from Settings. Equal or one blank = single target |
| Rate | Optional rate cap or target, shown as text |
| Notes | |

Work, Rest and Start every are text typed like Settings values and parsed with `parseTime` when read; they are plan config, not logged data.

## Schedule
Date, Squad (All / Varsity / Novice), Session (Practice / OYO), Workout ID, Published (checkbox; unticked rows never reach athletes), Notes.

Targets, plan matches and hits are computed when read (`Plan.gs`), never stored. Practices' "Planned workout" column is free text; the Schedule tab is what targets and plan checks use.

## Settings
Key, Value, Notes. Values are text. See `SETTINGS_DEFAULTS` in Config.gs for every key.

## Squad history
School year (text, e.g. 2025-26), Athlete ID, Athlete, Squad. Filled by "Save squads for this school year"; used so past years compare against the squads as they were.

## Races (coach-only)
Date, Regatta, Championship (checkbox), Event, Boat (8+ / 4+), Round, Time, Place, 1st time, 2nd time, 3rd time, Seat 1 … Seat 8, Cox, Notes. Times are typed as m:ss.0 text and parsed when read. Seat 1 = bow, Seat 8 = stroke; a 4+ uses Seats 1-4. Seats are Roster names.

## Change log
Timestamp, Who, Tab, Cell, Row ID, Field, Old value, New value, Note.
