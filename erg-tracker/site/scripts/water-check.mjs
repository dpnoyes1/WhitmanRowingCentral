// Hand check of real SpeedCoach / CoxBox files (plan Step 0: "the three October 18 files give the numbers in section 1").
// node erg-tracker/site/scripts/water-check.mjs <folder or files...>   Prints one line per file. Real files stay OUTSIDE the repo.
import fs from 'node:fs';
import path from 'node:path';
import { readFit } from '../lib/fit.mjs';
import { summarize } from '../lib/water.mjs';

const fmt = (s) => (s == null ? '-' : Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'));
const hms = (s) => (s == null ? '-' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0'));
const files = process.argv.slice(2).flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => /\.fit$/i.test(f)).map((f) => path.join(p, f)) : [p]));
if (!files.length) { console.log('Usage: node erg-tracker/site/scripts/water-check.mjs <folder with .fit files>'); process.exit(1); }

console.log(['File', 'Unit', 'Start (ET)', 'Kind', 'Moving', 'Elapsed', 'Meters', 'Avg split', 'Rate', 'Best 1 min', 'Best 5 min', 'Best 10 min', 'Pieces'].join(' | '));
for (const f of files) {
  try {
    const fit = readFit(fs.readFileSync(f), f);
    const s = summarize(fit);
    const best = (d) => { const p = s.curve.find((x) => x.durS === d); return p ? fmt(p.splitS) : '-'; };
    const start = s.start ? new Date(s.start * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '-';
    console.log([path.basename(f), s.unit + ' (' + fit.unitSource + ')', start, s.kind, hms(s.movingS), hms(s.elapsedS), s.meters, fmt(s.avgSplitS), s.avgRate,
      best(60), best(300), best(600), s.pieces.map((p) => p.meters + 'm ' + fmt(p.splitS)).join(', ') || '-'].join(' | '));
    if (s.warnings.length) console.log('   notes: ' + s.warnings.join('; '));
    const f0 = fit.strokes.find((x) => x.dps != null);
    console.log('   fields: ' + fit.strokes.length + ' strokes, laps ' + fit.laps.length + ', session ' + (fit.session ? 'yes' : 'no') + ', distance/stroke ' + (f0 ? 'yes' : 'no') + ', GPS ' + (fit.strokes.some((x) => x.lat != null) ? 'yes' : 'no'));
  } catch (e) { console.log(path.basename(f) + ' | could not read: ' + e.message); }
}
