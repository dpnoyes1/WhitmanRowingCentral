// A few click-through flows on the dummy data and the fake Sheet: sign in, plan a workout, log an activity.
// Each flow starts in its own fresh browser window and fails with a plain message.
import assert from 'node:assert';
import { newPage, signInCoach, signInAthlete } from './lib.mjs';
import { COACH } from './server.mjs';
import { clearFeedCache } from '../../lib/feed.mjs';

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
  await page.click('[data-day="2026-10-22"]');
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

flow('plan: Save and Cancel work on the first click right after typing in a field', async ({ browser, server }) => {
  const page = await newPage(browser, 1280);
  await signInCoach(page, server.url, '#/plan');
  await page.click('[data-day="2026-10-22"]');
  await page.click('[data-add="2026-10-22"]');
  await page.click('[data-type=open]');
  await page.fill('input[data-k=name]', "60' any activity");   // still focused when the button is pressed
  await page.click('[data-save=draft]');
  await page.waitForSelector('#pnotice .notice');
  assert.equal(server.state.saves.at(-1).publish, false, 'one click on Save draft saved the draft');
  await page.click('[data-day="2026-10-23"]');
  await page.click('[data-add="2026-10-23"]');
  await page.click('[data-type=open]');
  await page.fill('input[data-k=name]', 'to cancel');
  await page.click('[data-cancel]');
  assert.equal(await page.locator('[data-cancel]').count(), 0, 'one click on Cancel closed the builder');
  await page.context().close();
});

flow('plan: Publish week publishes every draft of the week after a confirm, Unpublish week undoes it', async ({ browser, server }) => {
  const page = await newPage(browser, 390);
  await signInCoach(page, server.url, '#/plan');
  for (const d of ['2026-10-22', '2026-10-23']) {
    await page.click(`[data-day="${d}"]`);
    await page.click(`[data-add="${d}"]`);
    await page.click('[data-type=open]');
    await page.fill('input[data-k=name]', "60' any activity " + d);
    await page.evaluate(() => document.querySelector('[data-save=draft]').click());
    await page.waitForSelector('#pnotice .notice');
  }
  const was = server.state.upcoming.filter((u) => u.published).length, drafts = server.state.upcoming.length - was;   // earlier flows share this fake Sheet
  await page.click('[data-bulk=publish]:not([data-scope])');
  assert.match(await page.textContent('.pbulk'), new RegExp(`Publish ${drafts} drafts`));
  assert.equal(server.state.upcoming.filter((u) => u.published).length, was, 'the confirm alone publishes nothing');
  await page.click('[data-bulkno]');
  assert.equal(await page.locator('.pbulk').count(), 0);
  await page.click('[data-bulk=publish]:not([data-scope])');
  await page.click('[data-bulkyes]');
  await page.waitForSelector('#pnotice .notice');
  assert.match(await page.textContent('#pnotice'), new RegExp(`Published ${drafts} workouts`));
  assert.equal(server.state.upcoming.filter((u) => u.published).length, was + drafts);
  assert.equal(await page.locator('[data-bulk=publish]:not([data-scope])').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing scrolls sideways');
  await page.click('[data-bulk=unpublish]:not([data-scope])');
  await page.click('[data-bulkyes]');
  await page.waitForSelector('#pnotice .notice');
  assert.equal(server.state.upcoming.filter((u) => u.published).length, 0, 'Unpublish week sends the whole week back to draft');
  await page.context().close();
});

flow('plan: Publish day publishes only that day after a confirm; days stack and several can be open on desktop', async ({ browser, server }) => {
  const page = await newPage(browser, 1280);
  await signInCoach(page, server.url, '#/plan');
  for (const d of ['2026-10-22', '2026-10-23']) {
    await page.click(`[data-day="${d}"]`);
    await page.click(`[data-add="${d}"]`);
    await page.click('[data-type=open]');
    await page.fill('input[data-k=name]', 'day test ' + d);
    await page.evaluate(() => document.querySelector('[data-save=draft]').click());
    await page.waitForSelector('#pnotice .notice');
  }
  assert.equal(await page.locator('.pday.open').count(), 2, 'on desktop both days stay open');
  const rows = await page.locator('.prow').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  assert.ok(rows.every((w) => w === rows[0]), 'every day row is the same full width');
  const thuTitles = await page.locator('.pday[data-g="2026-10-22"] .ptitle').allTextContents();
  assert.ok(thuTitles.includes('day test 2026-10-22'), 'the collapsed row lists the workout titles');
  const published = () => server.state.upcoming.filter((u) => u.published && u.day === '2026-10-22').length;
  const fri = () => server.state.upcoming.filter((u) => u.published && u.day === '2026-10-23').length;
  const f0 = fri(), t0 = published();
  await page.click('.pday[data-g="2026-10-22"] [data-bulk=publish]');
  assert.match(await page.textContent('.pday[data-g="2026-10-22"] .pbulk'), /Publish \d+ drafts? for Thursday/);
  assert.equal(published(), t0, 'the confirm alone publishes nothing');
  await page.click('[data-bulkyes]');
  await page.waitForSelector('#pnotice .notice');
  assert.ok(published() > t0, "Publish day published Thursday's drafts");
  assert.equal(fri(), f0, "and left Friday's drafts alone");
  await page.click('.prow[data-day="2026-10-22"]');
  assert.equal(await page.locator('.pday.open').count(), 1, 'a row closes when tapped again');
  await page.context().close();
  const ph = await newPage(browser, 390);
  await signInCoach(ph, server.url, '#/plan');
  await ph.click('[data-day="2026-10-22"]');
  await ph.click('[data-day="2026-10-23"]');
  assert.equal(await ph.locator('.pday.open').count(), 1, 'on a phone opening a day closes the others');
  assert.equal(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing scrolls sideways');
  await ph.context().close();
});

flow('plan: an open workout (any activity, 60 minutes) saves with no activity or zone', async ({ browser, server }) => {
  const page = await newPage(browser, 390);
  await signInCoach(page, server.url, '#/plan');
  await page.click('[data-day="2026-10-22"]');
  await page.click('[data-add="2026-10-22"]');
  await page.click('[data-type=open]');
  assert.equal(await page.locator('[data-act]').count(), 0, 'no Erg / Run choice for an open workout');
  assert.equal(await page.locator('[data-paceon]').count(), 0, 'no pace target for an open workout');
  assert.match(await page.textContent('#pv'), /Open/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'nothing scrolls sideways');
  await page.fill('input[data-k=name]', "60' any activity");
  await page.evaluate(() => document.querySelector('[data-save=publish]').click());   // the phone's tab bar can sit over the button for a real click
  await page.waitForSelector('#pnotice .notice');
  const save = server.state.saves.at(-1);
  assert.equal(save.pieces[0].workType, 'Open');
  assert.equal(save.pieces[0].work, '60:00');
  assert.equal(save.pieces[0].zone, '');
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
  await page.waitForSelector('.logdone');
  assert.match(await page.textContent('.logdone h2'), /^Saved/);
  assert.match(await page.textContent('.logdone-what'), /Run, 3\.1 miles, 25:30, today/);
  await page.click('#lm-again');
  await page.waitForSelector('#logmine');
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

flow('lineups: priority numbers rank or share the boats, nothing pins itself, an athlete cannot open the page', async ({ browser, server }) => {
  let page = await newPage(browser, 1280);
  await signInCoach(page, server.url, '#/lineups');
  await page.waitForSelector('.lugrid');
  const gms = () => page.$$eval('.lub', (cards) => cards.map((c) => parseFloat(c.querySelector('.lua b.acc').textContent)));
  const build = async (sizes, pris) => {
    while (await page.locator('[data-lurm]').count()) await page.click('[data-lurm] >> nth=0');
    for (const n of sizes) await page.click(`[data-luadd="${n}"]`);
    for (let i = 0; i < pris.length; i++) { await page.fill(`#lupri-${i}`, String(pris[i])); await page.press(`#lupri-${i}`, 'Tab'); }
    await page.click('[data-lueven]');
    return gms();
  };
  const ranked = await build([8, 8, 8], [1, 2, 3]);
  assert.ok(ranked[0] > ranked[1] && ranked[1] > ranked[2], '1,2,3 should go strongest to weakest: ' + ranked);
  const even = await build([8, 8, 8], [1, 1, 1]);
  assert.ok(Math.max(...even) - Math.min(...even) < 1, '1,1,1 should be even: ' + even);
  const mixed = await build([4, 4, 4, 8, 8], [1, 1, 1, 2, 2]);
  assert.ok(Math.min(...mixed.slice(0, 3)) > Math.max(...mixed.slice(3)), 'the three 4+ (priority 1) should beat the 8s (priority 2): ' + mixed);
  // A new boat starts with a real number, and typing a priority then tapping a button must not lose that tap (the page used to redraw on blur).
  await page.click('[data-luadd="8"]');
  const last = await page.$$eval('.lupri', (els) => els[els.length - 1].value);
  assert.ok(/^[1-9]$/.test(last), 'new boat priority should be a number, got "' + last + '"');
  await page.click('[data-luclear]');
  await page.fill('#lupri-0', '2');
  await page.click('[data-lueven]');
  assert.ok((await page.$$eval('.lus .luc', (e) => e.length)) > 0, 'the tap right after typing a priority was lost');
  // Boat names can't inject markup.
  await page.fill('[data-luname="0"]', '<img src=x onerror=window.__xss=1>');
  await page.press('[data-luname="0"]', 'Tab');
  await page.click('[data-lueven]');
  assert.equal(await page.evaluate(() => window.__xss === 1), false, 'a boat name ran as markup');
  await build([4, 4, 4, 8, 8], [1, 1, 1, 2, 2]);
  assert.equal(await page.locator('.lupin.on').count(), 0, 'Auto Lineups must not pin anyone');
  await page.click('.lupin >> nth=0');
  assert.equal(await page.locator('.lupin.on').count(), 1, 'a tap on the pin button pins one seat');
  // A boat's name stays with that boat when another boat is removed, and a practice goal keeps pinned seats (David, 2026-11-18).
  await build([8, 8, 8], [1, 1, 1]);
  await page.fill('[data-luname="0"]', 'Alpha'); await page.press('[data-luname="0"]', 'Tab');
  await page.fill('[data-luname="1"]', 'Bravo'); await page.press('[data-luname="1"]', 'Tab');
  await page.fill('[data-luname="2"]', 'Charlie'); await page.press('[data-luname="2"]', 'Tab');
  await page.click('[data-lurm] >> nth=0');
  const names = await page.$$eval('[data-luname]', (els) => els.map((e) => e.value));
  assert.deepEqual(names, ['Bravo', 'Charlie'], 'names moved to the wrong boat after a removal: ' + names);
  await page.click('[data-lugoal="1"]');
  await page.click('.lupin >> nth=0');
  const pinned = await page.$eval('.lupin.on', (el) => el.closest('[data-luseat]').textContent);
  await page.click('[data-lugoal="0"]');
  assert.equal(await page.locator('.lupin.on').count(), 1, 'a practice goal wiped the pinned seat');
  assert.equal(await page.$eval('.lupin.on', (el) => el.closest('[data-luseat]').textContent), pinned);
  await page.context().close();
  page = await newPage(browser, 390);
  await signInAthlete(page, server.url, server.athlete, '#/lineups');
  assert.equal(await page.locator('.lugrid').count(), 0, 'an athlete should not get the Lineups page');
  await page.context().close();
});

flow('attendance: a coach changes one mark, an athlete has no way to', async ({ browser, server }) => {
  let page = await newPage(browser, 390);
  await signInCoach(page, server.url, '#/attendance');
  await page.waitForSelector('#mark-card');
  assert.equal(await page.$eval('#mk-save', (b) => b.disabled), true, 'Save should wait for an athlete and a mark');
  const first = await page.$eval('#mk-athlete option:nth-child(2)', (o) => ({ id: o.value, name: o.textContent }));
  await page.selectOption('#mk-athlete', first.id);
  await page.click('[data-mark="completed"]');
  await page.fill('#mk-note', 'First day, no workout to log');
  assert.equal(await page.$eval('#mk-save', (b) => b.disabled), false);
  await page.click('#mk-save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('mk-msg').textContent));
  const sent = server.state.marks[server.state.marks.length - 1];
  assert.equal(sent.athleteId, first.id);
  assert.equal(sent.mark, 'Full');
  assert.equal(sent.note, 'First day, no workout to log');
  assert.match(sent.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'the page scrolls sideways');
  await page.context().close();
  page = await newPage(browser, 390);
  await signInAthlete(page, server.url, server.athlete, '#/attendance');
  assert.equal(await page.locator('#mark-card').count(), 0, 'an athlete should not see Change a mark');
  await page.context().close();
});

flow('coxswain: Week lists every athlete\'s target, no results, nothing scrolls sideways', async ({ browser, server }) => {
  const me = server.feed.athletes.find((a) => a.id === server.athlete.id);
  me.role = 'Coxswain';
  clearFeedCache();
  try {
    for (const width of [320, 390, 1280]) {
      const page = await newPage(browser, width);
      await signInAthlete(page, server.url, server.athlete, '#/week');
      await page.waitForSelector('#wk-detail .targets-list table');
      const names = await page.$$eval('#wk-detail .targets-list tbody tr', (rows) => rows.length);
      assert.ok(names > 5, 'every rower is listed');
      assert.equal(await page.locator('#wk-detail .results-sort').count(), 0, 'no results sorting for a coxswain');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `the page scrolls sideways at ${width}`);
      assert.equal(await page.evaluate(() => { const w = document.querySelector('#wk-detail .targets-list .table-wrap'); return w.scrollWidth <= w.clientWidth; }), true, `the target table scrolls sideways at ${width}`);
      await page.context().close();
    }
  } finally { me.role = 'Rower'; clearFeedCache(); }
});

export default async function e2e(ctx) {
  let ok = true;
  for (const [name, fn] of flows) {
    try { await fn(ctx); console.log('  ok  ', name); } catch (err) { ok = false; console.log('  FAIL', name, '\n      ', err.message.split('\n')[0]); }
  }
  return { ok };
}
