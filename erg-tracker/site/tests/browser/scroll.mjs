// Sideways-scroll check (David's standing rule, 2026-11-17). Opens every page as an athlete and as a coach at small phone (320), phone,
// iPad (upright, 768 and 820) and desktop widths on the dummy data, and reports anything that scrolls sideways:
//   page   = the whole page is wider than the screen
//   inner  = a box on the page has its own sideways scroll bar (a wide table)
// Anything listed in known-scroll.json is an expected failure (already found, fix is elsewhere). A NEW one fails the run.
// A listed one that no longer happens is reported, so it can be removed from the list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newPage, signInCoach, signInAthlete } from './lib.mjs';

export const WIDTHS = [320, 360, 390, 768, 820, 1280];
const ATHLETE_PAGES = ['#/team', '#/week', '#/boards', '#/oyo', '#/athletes', '#/me', '#/attendance', '#/logrun', '#/athlete/A902'];
const COACH_PAGES = ['#/team', '#/week', '#/week/A901', '#/week/prev', '#/boards', '#/oyo', '#/athletes', '#/athlete/A901', '#/attendance', '#/stars', '#/insights',
  '#/lineups', '#/balance', '#/plan', '#/log', '#/weights', '#/settings'];
const KNOWN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'known-scroll.json');

// Runs inside the page. Returns what scrolls sideways.
const probe = () => {
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push({ kind: 'page', sel: 'document', by: de.scrollWidth - de.clientWidth });
  const name = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
      const cls = [...e.classList].slice(0, 2).join('.');
      parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : cls ? '.' + cls : ''));
    }
    return parts.join(' > ');
  };
  for (const el of document.querySelectorAll('#app *')) {
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) out.push({ kind: 'inner', sel: name(el), by: el.scrollWidth - el.clientWidth });
  }
  return out;
};

async function sweepWidth(browser, role, pages, signIn, width) {
  const found = [];
  const page = await newPage(browser, width);
  await signIn(page);
  for (const hash of pages) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction((h) => location.hash === h, hash);
    // Wait for the page's own heading (the loading cards have none), then let layout and fonts settle.
    await page.waitForSelector('#app h1');
    await page.waitForTimeout(350);
    const bad = await page.evaluate(probe);
    for (const b of bad) found.push({ key: `${role} ${hash} @${width} ${b.kind} ${b.sel}`, by: b.by });
    if (page.errors.length) found.push({ key: `${role} ${hash} @${width} script-error ${page.errors.splice(0)[0]}`, by: 0 });
  }
  await page.context().close();
  return found;
}
const sweep = async (browser, role, pages, signIn) => (await Promise.all(WIDTHS.map((w) => sweepWidth(browser, role, pages, signIn, w)))).flat();

export default async function scrollCheck({ browser, server }) {
  const known = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')).expected;
  const found = [
    ...await sweep(browser, 'athlete', ATHLETE_PAGES, (p) => signInAthlete(p, server.url, server.athlete)),
    ...await sweep(browser, 'coach', COACH_PAGES, (p) => signInCoach(p, server.url))
  ];
  if (process.env.SCROLL_WRITE_KNOWN) {
    fs.writeFileSync(KNOWN_FILE, JSON.stringify({ note: 'Sideways scrolling already found. A new one fails the run. Remove a line when its fix lands.', expected: found.map((f) => f.key).sort() }, null, 1) + '\n');
    console.log('wrote', found.length, 'known entries');
    return { ok: true };
  }
  const isKnown = (k) => known.includes(k);
  const fresh = found.filter((f) => !isKnown(f.key));
  const gone = known.filter((k) => !found.some((f) => f.key === k));
  for (const f of fresh) console.log('  NEW sideways scroll:', f.key, f.by ? `(${f.by}px too wide)` : '');
  for (const k of gone) console.log('  no longer scrolls (remove from known-scroll.json):', k);
  console.log(`  scroll: ${found.length} found, ${found.length - fresh.length} expected, ${fresh.length} new`);
  return { ok: fresh.length === 0 };
}
