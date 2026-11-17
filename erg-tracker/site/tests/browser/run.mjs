// Browser checks: node erg-tracker/site/tests/browser/run.mjs [scroll|e2e]
// Runs the real site code on the dummy data against a fake Sheet. Needs Playwright (not in the Netlify build).
import { startServer } from './server.mjs';
import { loadPlaywright } from './lib.mjs';
import scrollCheck from './scroll.mjs';
import e2e from './e2e.mjs';

const only = process.argv[2];
const { chromium } = loadPlaywright();
const server = await startServer();
const browser = await chromium.launch();
let ok = true;
try {
  for (const [name, fn] of [['scroll', scrollCheck], ['e2e', e2e]]) {
    if (only && only !== name) continue;
    const t = Date.now();
    console.log(`${name}:`);
    const r = await fn({ browser, server });
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    ok = ok && r.ok;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);
