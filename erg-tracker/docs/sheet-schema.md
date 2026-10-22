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

## Entries (one row per session)
Entry ID, Submitted at, Date, Athlete ID, Athlete, Entered by, Session type (Practice / OYO / Make-up), Make-up for date, Status (Full / Modified / Out; practice and make-up only), Activity, Warmup s, Work s, Rest s, Cooldown s, Work m, Rest m, Main set, Zone (UT2/UT1/AT/AN), RPE (1-10), Avg HR, Drag factor, Intervals (count), Coach note, Source (Form / Slack / Logbook), Review status, Response ID.

Work s / Rest s / Work m / Rest m are sums of the Intervals rows, stored for convenience. Weighted minutes are never stored.

## Intervals
Entry ID, Interval #, Work s, Work m, Avg rate, Rest s, Rest m.

## Benchmarks
Benchmark ID, Submitted at, Date, Athlete ID, Athlete, Entered by, Test (100m / 500m / 2000m / 20min / 30r20), Time s (timed tests), Meters (distance tests), Avg rate, Drag factor, Splits s (comma separated seconds), Coach note, Source, Review status, Response ID.

30r20 validity (avg rate <= 20) and GMS are computed at display, not stored.

## Weights (hidden, coach-only)
Date, Athlete ID, Athlete, Weight lb, Entered by, Note.

## Practices
Date, Squad, Shift (Early / Late), Start, End, Window start, Window end (text HH:MM), Status (Scheduled / Canceled), Planned workout, Notes.

## Settings
Key, Value, Notes. Values are text. See `SETTINGS_DEFAULTS` in Config.gs for every key.

## Change log
Timestamp, Who, Tab, Cell, Row ID, Field, Old value, New value, Note.
