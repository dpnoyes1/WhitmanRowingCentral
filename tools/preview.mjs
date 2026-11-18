// Local preview of the team site on FAKE data (David, 2026-11-17): `node tools/preview.mjs`.
// Runs the real site pages and /api handlers against the dummy feed and an in-memory fake Sheet
// (erg-tracker/site/tests/browser/server.mjs), so nothing real is read or written and no Netlify
// build or credentials are involved. Open it on the Mac or, on the same Wi-Fi, on a phone.
// Lives outside erg-tracker/site/ on purpose: a change there makes Netlify build on merge.
import http from 'node:http';
import os from 'node:os';

const port = Number(process.env.PORT) || 8888;

// The browser-check server only listens on this Mac. Open it to the Wi-Fi, and drop the cookie's Secure flag
// (browsers refuse Secure cookies on a plain http://192.168... address, so a phone could not stay signed in).
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (p, host, ...rest) {
  return listen.call(this, p, host === '127.0.0.1' ? '0.0.0.0' : host, ...rest);
};
const writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (status, headers, ...rest) {
  if (headers && !Array.isArray(headers) && typeof headers === 'object') {
    const k = Object.keys(headers).find((x) => x.toLowerCase() === 'set-cookie');
    if (k) headers[k] = [].concat(headers[k]).map((c) => String(c).replace(/;\s*Secure/gi, ''));
  }
  return writeHead.call(this, status, headers, ...rest);
};

const { startServer, COACH } = await import('../erg-tracker/site/tests/browser/server.mjs');
const server = await startServer({ port });
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);

console.log('\nFAKE-DATA PREVIEW running. Nothing here touches the real Sheet.\n');
console.log('  On this Mac:  http://localhost:' + port);
console.log(lan ? '  On a phone:   http://' + lan.address + ':' + port + '  (same Wi-Fi)' : '  On a phone:   no Wi-Fi address found');
console.log('\nSign in (all made up):');
console.log('  Coach:        ' + COACH.name + ' / ' + COACH.birthday);
console.log('  Athlete:      ' + server.athlete.name + ' / password ' + server.athlete.password);
console.log('  New athlete:  ' + server.newAthlete.name + ' / ' + server.newAthlete.birthday + '  (sets a first password)');
console.log('\nPage and style edits show on refresh. Restart after changing functions or lib. Ctrl-C stops it.\n');
