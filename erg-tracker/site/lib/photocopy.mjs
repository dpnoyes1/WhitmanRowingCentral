// The small copy of an erg-screen photo that is kept in Drive (photo plan step 6;
// David, 2026-10-28): about 150 KB, upright, with every bit of metadata (location,
// camera, time) gone, because the re-encode writes only pixels. Only this copy is
// kept; the original is never stored. `sharp` loads on first use so the rest of
// the site works, and tests can pass a fake, without it.
export const TARGET_BYTES = 150 * 1024;
export const HARD_MAX_BYTES = 200 * 1024;   // the Sheet's script refuses anything over ~300 KB
const SIZES = [1280, 1024, 800, 640];        // longest side, tried in order
const QUALITIES = [80, 70, 60, 50, 40];

let sharpModule;
async function loadSharp() {
  if (!sharpModule) sharpModule = (await import('sharp')).default;
  return sharpModule;
}

/**
 * Photo bytes (JPEG or PNG) -> { bytes, width, height } of a JPEG near TARGET_BYTES.
 * Tries the largest size and best quality first and steps down until it fits.
 * Throws if the image cannot be read or never gets under HARD_MAX_BYTES.
 */
export async function makeKeepCopy(input, { sharp } = {}) {
  const lib = sharp || await loadSharp();
  let best;
  for (const side of SIZES) {
    for (const quality of QUALITIES) {
      // rotate() applies the camera's orientation before the tag is dropped; no withMetadata(), so nothing else is kept.
      const { data, info } = await lib(input, { failOn: 'error' }).rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      best = { bytes: data, width: info.width, height: info.height };
      if (data.length <= TARGET_BYTES) return best;
    }
  }
  if (best.bytes.length > HARD_MAX_BYTES) throw new Error('Could not shrink the photo');
  return best;
}
