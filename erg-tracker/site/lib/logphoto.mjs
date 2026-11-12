// Optional proof photo on a site log (David, 2026-11-12): the page sends a shrunk JPEG as base64; the kept copy is
// re-encoded here (about 150 KB, upright, no location or other metadata) before it goes to the Sheet.
import { makeKeepCopy } from './photocopy.mjs';

/** -> { photo: base64 | '' } or { error, status } for a bad or unreadable photo. */
export async function prepPhoto(raw, deps = {}) {
  if (raw === undefined || raw === null || raw === '') return { photo: '' };
  if (typeof raw !== 'string' || raw.length > 6_000_000 || !/^[A-Za-z0-9+/=]+$/.test(raw)) return { error: 'That photo could not be used.', status: 400 };
  try {
    return { photo: Buffer.from((await makeKeepCopy(Buffer.from(raw, 'base64'), { sharp: deps.sharp })).bytes).toString('base64') };
  } catch (err) {
    console.error('site log photo error:', err.message);
    return { error: 'That photo could not be read. Try another one, or save without it.', status: 422 };
  }
}
