# Setup steps

About 15 minutes. You need a Google account that will own the Sheet and Form (use the one coaches will share).

## 1. Create the Sheet and paste the script

1. Go to [sheets.new](https://sheets.new) and name the spreadsheet **Whitman Erg Tracker**.
2. Open **Extensions > Apps Script**. A script editor opens in a new tab.
3. Name the project **Erg Tracker** (click "Untitled project" at the top).
4. Delete the sample `Code.gs` file's contents. Then for each file in this repo's `apps-script/` folder, click **+ > Script**, give it the same name without `.gs` (`Config`, `Time`, `Gms`, `Sheet`, `Form`, `Submit`, `Setup`), and paste the file's contents. You can delete the empty `Code.gs` afterwards.
5. Click the gear icon (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**, go back to the editor and replace `appsscript.json` with the repo's version.
6. Click **Save** (the disk icon).

## 2. Run setup

1. Go back to the Sheet tab and reload the page. An **Erg Tracker** menu appears after a few seconds.
2. Click **Erg Tracker > Set up Sheet and Form**.
3. Google asks you to authorize the script. Click **Continue**, choose your account, then **Advanced > Go to Erg Tracker (unsafe) > Allow**. ("Unsafe" just means Google hasn't reviewed your personal script.)
4. Run **Set up Sheet and Form** again if it stopped after authorizing. When it finishes it shows the share link.

You now have all ten tabs, the Form, a raw responses backup tab, and two triggers (form submit, and edit logging).

## 3. Fill in the basics

1. **Roster tab:** add each athlete's Name, Slack member ID, Squad, Role (Rower or Coxswain), OYO group and Active = Yes. Leave Athlete ID blank; it fills itself. The Form's name lists update when you edit the Roster. If they don't, use **Erg Tracker > Refresh form name lists from Roster**.
2. **Settings tab:** check the coach names, then set `season.winter_start` and `season.winter_end` (YYYY-MM-DD).
3. **Erg Tracker > Generate practice schedule** fills the Practices tab. Mark holidays and snow days as Canceled in the Status column.
4. **Weights tab** is hidden. To open it: the menu at the bottom-left (all sheets list) > Weights. Coaches type weights there directly. It is never on the Form.

## 4. Plan a week

1. **Workouts tab** is the library. One row per piece, so a workout is one or more rows sharing a Workout ID (e.g. `PYR`).
   - Same pieces: one row with Reps, e.g. 3 x Time 20:00, Rest 2:00, Zone UT1.
   - Variable intervals (2000/1500/1000/500/250): one row per piece, Piece # 1 to 5, each with its own Work, Rest and target.
   - Common start (8 x 500m, everyone goes together): Reps 8, Distance 500, Start every 3:30, Rest blank. For coach-called starts, Rest = Undefined.
   - Activity defaults to Erg (RowErg). Only RowErg pieces get watts targets.
   - Target: pick Base (2k or 20') and Target low % / high %. Leave % blank to use the zone default from Settings (`target.<zone>.2000m` / `.20min`). A range (UT2, UT1) shows a range; one number (AT, AN) shows a single target.
2. **Schedule tab:** one row per session: Date, Squad (All / Varsity / Novice), Session (Practice / OYO), Workout ID. Tick **Published** when athletes should see it. To plan from last week, copy last week's rows and change the dates.
3. **Erg Tracker > Preview week ahead** writes a *Week ahead (preview)* tab with every athlete's targets, drafts included. FLAG rows at the top list athletes with no 2k or 20' this season or last; they get no target.
4. **Erg Tracker > Check week against plan** writes a *Plan check* tab: each logged practice, OYO and make-up checked against its planned workout (did the plan, hit target, watts per interval). Make-ups are checked against the missed day's workout.

Targets use season-best watts (school year from `school_year_start`), falling back to last season. Rejected benchmark rows are ignored. Weight is never used.

## 5. Share

- Share the link saved in **Settings > form.share_url** with athletes. Use that link, not the Form's plain link: it prefills warmup 15:00 and drag factor 105.
- Share the Sheet itself only with coaches.

## 6. Test it

Submit one Practice with two intervals and one 2000m test through the share link, then check:
- Entries has one row, with Warmup s = 900 if you left 15:00.
- Intervals has two rows.
- Benchmarks has the 2k with Time s in seconds (7:42.8 -> 462.8), and Entries has a second row for that test session with the same Benchmark ID.

Delete the test rows when you're done (the Change log will record the deletions as edits).

## If something goes wrong

- A submission didn't appear: check the **Change log** for a `SUBMIT ERROR` row. The usual cause is an athlete name not on the Roster. Fix the Roster, then run **Erg Tracker > Process missed form responses**. It only adds responses that aren't already in the Sheet.
- Every raw answer is also in the **Form responses (raw)** tab, so nothing is lost.
- To change a question's wording, ask Claude to change it in `Config.gs`, then paste the new file and run **Erg Tracker > Rebuild form (new link)**. Editing the question directly in the Form editor breaks the link between that question and the Sheet.

## Optional: clasp instead of copy/paste

If you'd rather push code from the repo: `npm i -g @google/clasp`, `clasp login`, enable the Apps Script API at script.google.com/home/usersettings, copy the script ID from Project Settings into `.clasp.json` as `{"scriptId": "...", "rootDir": "apps-script"}`, then `clasp push`.
