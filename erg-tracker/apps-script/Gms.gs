/**
 * Gold Medal Standard math, derived from the "Erg to Water Times" chart.
 * Pure functions so the Netlify site can port them line for line.
 *
 * Weight is an input here and nowhere else. Results returned to athletes
 * must only ever talk about time, split or meters (see CLAUDE.md).
 */

var GMS_DEFAULTS = {
  factor1500: 0.75,      // P = factor1500 * T * (W / refWeight)^exponent
  refWeight: 270,
  exponent: 0.222,
  standard: 300,         // 1v8 standard, 5:00 for 1500m. GMS % is always vs this.
  offset20min: 8.5,      // 2k split = 20' split - 8.5s
  divisor500: 0.895,     // 2k split = 500m split / 0.895
  divisor100: 0.786,     // 2k split = 100m split / 0.786
  // Stars 1-5 by GMS % (David, 2026-10-23): every 2k or 20' earns 1, and each
  // band's lower edge is in it (exactly 95.0% is 2 stars).
  stars: [
    { stars: 5, minPct: 100 },
    { stars: 4, minPct: 97 },
    { stars: 3, minPct: 96 },
    { stars: 2, minPct: 95 }
  ]
};

/**
 * 2k-equivalent time in seconds for a benchmark result.
 * test: '100m' | '500m' | '2000m' | '20min'. 30r20 has no GMS (intentional).
 * For time tests pass seconds; for 20min pass meters.
 */
function gmsEquivalent2k(test, result, opts) {
  var o = opts || GMS_DEFAULTS;
  var split;
  switch (test) {
    case '2000m': return result;
    case '500m':  split = result / o.divisor500; break;
    case '100m':  split = (result * 5) / o.divisor100; break;
    case '20min': split = (1200 * 500 / result) - o.offset20min; break;
    default: return null;
  }
  return split * 4;
}

/** Predicted 1500m 8+ time in seconds from a 2k time and weight in lbs. */
function gmsPredicted1500(t2k, weightLbs, opts) {
  var o = opts || GMS_DEFAULTS;
  return o.factor1500 * t2k * Math.pow(weightLbs / o.refWeight, o.exponent);
}

/** GMS % (100 = 1v8 standard). */
function gmsPercent(test, result, weightLbs, opts) {
  var o = opts || GMS_DEFAULTS;
  var t2k = gmsEquivalent2k(test, result, o);
  if (t2k === null || !weightLbs) return null;
  return 100 * o.standard / gmsPredicted1500(t2k, weightLbs, o);
}

/** Stars earned (1-5). Only 2000m and 20min earn stars; other tests return 0. */
function gmsStars(test, result, weightLbs, opts) {
  var o = opts || GMS_DEFAULTS;
  if (test !== '2000m' && test !== '20min') return 0;
  var pct = 100 * o.standard / gmsPredicted1500(gmsEquivalent2k(test, result, o), weightLbs, o);
  for (var i = 0; i < o.stars.length; i++) {
    if (pct >= o.stars[i].minPct) return o.stars[i].stars;
  }
  return 1;
}

/**
 * What it takes to reach the next star, phrased as speed only.
 * Returns null at the top star. For 2000m: { targetSeconds, secondsFaster,
 * splitFaster }. For 20min: { targetMeters, metersMore, splitFaster }.
 */
function gmsNextStar(test, result, weightLbs, opts) {
  var o = opts || GMS_DEFAULTS;
  var have = gmsStars(test, result, weightLbs, o);
  var next = null;
  for (var i = o.stars.length - 1; i >= 0; i--) {
    if (o.stars[i].stars === have + 1) next = o.stars[i];
  }
  if (!next) return null;
  var maxP = o.standard * 100 / next.minPct;
  var t2kNeeded = maxP / (o.factor1500 * Math.pow(weightLbs / o.refWeight, o.exponent));
  if (test === '2000m') {
    return {
      stars: next.stars,
      targetSeconds: t2kNeeded,
      secondsFaster: result - t2kNeeded,
      splitFaster: (result - t2kNeeded) / 4
    };
  }
  if (test === '20min') {
    var splitNeeded = t2kNeeded / 4 + o.offset20min;
    var metersNeeded = 1200 * 500 / splitNeeded;
    return {
      stars: next.stars,
      targetMeters: Math.ceil(metersNeeded),
      metersMore: Math.ceil(metersNeeded - result),
      splitFaster: (1200 * 500 / result) - splitNeeded
    };
  }
  return null;
}

/** Custom Sheet function for coach exploration: =GMS_PERCENT("2000m", 462.8, 150). */
function GMS_PERCENT(test, result, weightLbs) {
  return gmsPercent(test, result, weightLbs);
}
