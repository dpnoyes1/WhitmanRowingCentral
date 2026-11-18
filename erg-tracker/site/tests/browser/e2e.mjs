// A few click-through flows on the dummy data and the fake Sheet: sign in, plan a workout, log an activity.
// Each flow starts in its own fresh browser window and fails with a plain message.
import assert from 'node:assert';
import { newPage, signInCoach, signInAthlete } from './lib.mjs';
import { COACH } from './server.mjs';

const flows = [];
const flow = (name, fn) => flows.push([name, fn]);
const gotoHash = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector('#app h1'); };

flow('sign in: wrong password, first sign-in picks a password, birthday then refused, coach signs in', async ({ browser, server }) => {
  const a = server.newAthlete;
  let page = await newPage(browser, 390);
  await page.goto(server.url + '/#/team');
  await page.fill('#name', a.name);
  await page.fill('#pw', 'not-my-password');
  await page.click('#signin');
  await page.waitForFunction(() => document.getElementById('login-err').textContent.length > 0);
  assert.match(await page.textContent('#login-err'), /don't match/);
  // First time in: her birthday works once, then she chooses a password.
  await page.fill('#pw', a.birthday);
  await page.click('#signin');
  await page.waitForSelector('#npw');
  await page.fill('#npw', 'oar-swing-8');
  await page.fill('#npw2', 'oar-swing-9');
  await page.click('#savepw');
  assert.match(await page.textContent('#choose-err'), /do not match/);
  await page.fill('#npw', 'oar-swing-9');
  await page.fill('#npw2', 'oar-swing-9');
  await page.click('#savepw');
  await page.waitForSelector('body.authed', { state: 'attached' });
  await page.waitForSelector('#app h1');
  // Log out (phone: open the menu first), then the new password works and the birthday no longer does.
  await page.click('#menu-tab');
  await page.click('#usercard-btn');
  await page.click('#um-logout');
  await page.waitForSelector('#login');
  await page.fill('#name', a.name);
  await page.fill('#pw', a.birthday);
  await page.click('#signin');
  await page.waitForFunction(() => document.getElementById('login-err').textContent.length > 0);
  await page.fill('#pw', 'oar-swing-9');
  await page.click('#signin');
  await page.waitForSelector('body.authed', { state: 'attached' });
  await page.context().close();
  // A coach signs in with name and birthday and sees the coach tools.
  page = await newPage(browser, 1280);
  await signInCoach(page, server.url);
  assert.ok(await page.isVisible('#nav-plan'), 'coach sees Plan workouts');
  await page.context().close();
});

flow('plan: add a workout to Thursday, it shows on that day', async ({ browser, server }) => {
  const page = await newPage(browser, 1280);
  await signInCoach(page, server.url, '#/plan');
  assert.equal(await page.textContent('#app h1'), 'Plan workouts');
  await page.click('[data-add="2026-10-22"]');
  await page.fill('input[data-k=nl]', '2 x 20:00 with 1:00 rest, aerobic');
  await page.click('[data-fill]');
  assert.match(await page.textContent('#nlmsg'), /Filled in/);
  assert.match(await page.inputValue('input[data-k=name]'), /aerobic/i);
  await page.click('[data-save=publish]');
  await page.waitForSelector('#pnotice .notice');
  assert.match(await page.textContent('#pnotice'), /published/);
  const save = server.state.saves.at(-1);
  assert.deepEqual(save.dates, ['2026-10-22']);
  assert.equal(save.publish, true);
  assert.equal(save.keep, undefined, 'a one-off is not saved to the library unless ticked');
  assert.ok(save.pieces.length >= 1);
  const card = page.locator('.pday', { hasText: 'Thu' });
  assert.match(await card.textContent(), /aerobic/i);
  assert.match(await card.textContent(), /Published/);
  await page.context().close();
});

flow('log activity: an athlete logs a run and it reaches the Sheet', async ({ browser, server }) => {
  const page = await newPage(browser, 390);
  await signInAthlete(page, server.url, server.athlete, '#/logrun');
  assert.equal(await page.textContent('#app h1'), 'Log activity');
  await page.fill('[data-f=dist]', '3.1');
  await page.locator('[data-f=time]').pressSequentially('2530');   // the phone number pad has no colon
  assert.equal(await page.inputValue('[data-f=time]'), '25:30');
  await page.fill('[data-f=time]', '');
  await page.locator('[data-f=time]').pressSequentially('25:30');   // a typed colon (desktop) is left alone
  assert.equal(await page.inputValue('[data-f=time]'), '25:30');
  assert.match(await page.textContent('#lm-pace'), /\d:\d\d/);
  await page.click('#logmine button[type=submit]');
  await page.waitForSelector('#logmine .notice');
  assert.match(await page.textContent('#logmine .notice'), /^Saved/);
  const log = server.state.logs.at(-1);
  assert.equal(log.athleteId, server.athlete.id);
  assert.equal(log.self, true);
  assert.equal(log.form.activity, 'Run');
  assert.match(log.form.pieces, /^25:30(\.0)?, 49\d\d$/, 'got ' + log.form.pieces);   // 3.1 mi is about 4989 m
  await page.context().close();
});

flow('OYO page: an athlete sees their own row first, a coach sees plain ranking', async ({ browser, server }) => {
  let page = await newPage(browser, 390);
  await signInAthlete(page, server.url, server.athlete, '#/oyo');
  await page.waitForSelector('.oyo-row');
  const classes = await page.$$eval('.oyo-row', (els) => els.map((e) => e.classList.contains('me')));
  assert.ok(classes.length > 1);
  assert.equal(classes[0], true, 'own row is not first');
  assert.equal(classes.filter(Boolean).length, 1);
  // Bars run largest to smallest after the pinned row.
  const widths = await page.$$eval('.oyo-row:not(.me) .meter .fill', (els) => els.map((e) => parseFloat(e.style.width)));
  assert.deepEqual(widths, [...widths].sort((x, y) => y - x), 'bars are not in size order');
  await page.context().close();
  page = await newPage(browser, 1280);
  await signInCoach(page, server.url, '#/oyo');
  await page.waitForSelector('.oyo-row');
  assert.equal(await page.$$eval('.oyo-row.me', (els) => els.length), 0);
  await page.context().close();
});

export default async function e2e(ctx) {
  let ok = true;
  for (const [name, fn] of flows) {
    try { await fn(ctx); console.log('  ok  ', name); } catch (err) { ok = false; console.log('  FAIL', name, '\n      ', err.message.split('\n')[0]); }
  }
  return { ok };
}
