// Shared helpers for the browser checks. Needs Playwright, which Netlify does not install, so these run by hand
// (`node erg-tracker/site/tests/browser/run.mjs`), never in the Netlify build.
import { createRequire } from 'node:module';
import { COACH } from './server.mjs';

export function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch {
    console.error('Playwright is not installed. Cloud sessions have it; on a Mac run: npm install --no-save playwright && npx playwright install chromium');
    process.exit(2);
  }
}

export async function newPage(browser, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

async function signedIn(page) { await page.waitForSelector('body.authed', { state: 'attached' }); await page.waitForSelector('#app h1'); }

export async function signInCoach(page, url, hash = '#/team') {
  await page.goto(url + '/' + hash);
  await page.fill('#name', COACH.name);
  await page.fill('#pw', COACH.birthday);
  await page.click('#signin');
  await signedIn(page);
}

/** Signs in with her password (athlete = { name, password }). */
export async function signInAthlete(page, url, athlete, hash = '#/team') {
  await page.goto(url + '/' + hash);
  await page.fill('#name', athlete.name);
  await page.fill('#pw', athlete.password);
  await page.click('#signin');
  await signedIn(page);
}
