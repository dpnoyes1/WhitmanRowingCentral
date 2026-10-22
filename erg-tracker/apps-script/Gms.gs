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
  // Stars use the slower edge of each boat band (predicted 1500m seconds).
  stars: [
    { stars: 3, label: '1v8', maxP: 300 },
    { stars: 2, label: '2v8', maxP: 315 },
    { stars: 1, label: '3v/Fr8', maxP: 330 }
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

/** Stars earned (0-3). Only 2000m and 20min earn stars. */
function gmsStars(test, result, weightLbs, opts) {
  var o = opts || GMS_DEFAULTS;
  if (test !== '2000m' && test !== '20min') return 0;
  var p = gmsPredicted1500(gmsEquivalent2k(test, result, o), weightLbs, o);
  for (var i = 0; i < o.stars.length; i++) {
    if (p <= o.stars[i].maxP) return o.stars[i].stars;
  }
  return 0;
}

/**
 * What it takes to reach the next star, phrased as speed only.
 * Returns null at 3 stars. For 2000m: { targetSeconds, secondsFaster,
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
  var t2kNeeded = next.maxP / (o.factor1500 * Math.pow(weightLbs / o.refWeight, o.exponent));
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
