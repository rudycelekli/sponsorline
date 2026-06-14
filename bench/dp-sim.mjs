// v0.2-C2 decision harness — ZERO egress. Simulates the proposed anonymized-intel
// pipeline (k-anonymity suppression + Laplace differential privacy) over the real
// allowlisted taxonomy, and measures whether useful advertiser signal survives at
// realistic population sizes. Run: `node bench/dp-sim.mjs`. Nothing leaves the box.

// --- deterministic PRNG (mulberry32) so the verdict is reproducible -------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- proposed privacy parameters (candidates from the C2 design) ----------------
const K = 50; // k-anonymity suppression threshold
const EPSILON = 1.0; // DP budget per release
const SENSITIVITY = 1; // one developer affects a count by at most 1

// Laplace(0, b) where b = sensitivity / epsilon (inverse-CDF sampling)
function laplaceNoise(rng, b) {
  const u = rng() - 0.5;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

// --- realistic taxonomy + popularity weights (Zipf-ish) -------------------------
const BUCKETS = [
  ["lang:ts", 1.0], ["lang:py", 0.9], ["lang:rust", 0.45], ["lang:go", 0.35],
  ["framework:react", 0.6], ["framework:pytorch", 0.3], ["framework:tensorflow", 0.18],
  ["framework:clap", 0.12], ["task:build", 0.8], ["task:debug", 0.7], ["task:test", 0.55],
  ["task:refactor", 0.4], ["task:docs", 0.25], ["task:explore", 0.5],
];
const HEAD = new Set(["lang:ts", "lang:py", "framework:react", "task:build", "task:debug"]);

function trueCounts(rng, devs) {
  const counts = Object.fromEntries(BUCKETS.map(([b]) => [b, 0]));
  for (let d = 0; d < devs; d++) {
    for (const [b, w] of BUCKETS) if (rng() < w * 0.5) counts[b] += 1; // each dev hits a bucket w/ prob ~w/2
  }
  return counts;
}

// Apply the C2 pipeline: suppress below K, else release noised count (floored at 0).
function release(rng, counts) {
  const b = SENSITIVITY / EPSILON;
  const out = {};
  let suppressed = 0;
  for (const [bucket, c] of Object.entries(counts)) {
    if (c < K) { suppressed++; continue; }
    out[bucket] = Math.max(0, Math.round(c + laplaceNoise(rng, b)));
  }
  return { out, suppressed };
}

function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const rng = mulberry32(0xC2C2);
const POPULATIONS = [50, 200, 1000, 5000, 20000];
const TRIALS = 200; // average noise over many releases per population

console.log(`DP-sim (k=${K}, ε=${EPSILON}/release) — head buckets: ${[...HEAD].join(", ")}`);
console.log("N\thead-rel-err(med)\tsuppressed/total\thead-survived");

let firstUsefulN = null;
for (const N of POPULATIONS) {
  const truth = trueCounts(rng, N);
  const relErrs = [];
  let suppressedSum = 0, headSurvivedSum = 0;
  for (let t = 0; t < TRIALS; t++) {
    const { out, suppressed } = release(rng, truth);
    suppressedSum += suppressed;
    let headSurvived = 0;
    for (const b of HEAD) {
      if (out[b] !== undefined) {
        headSurvived++;
        if (truth[b] > 0) relErrs.push(Math.abs(out[b] - truth[b]) / truth[b]);
      }
    }
    headSurvivedSum += headSurvived;
  }
  const medErr = median(relErrs);
  const avgSuppressed = (suppressedSum / TRIALS).toFixed(1);
  const avgHeadSurvived = (headSurvivedSum / TRIALS).toFixed(1);
  const errPct = (medErr * 100).toFixed(2);
  console.log(`${N}\t${errPct}%\t\t\t${avgSuppressed}/${BUCKETS.length}\t\t${avgHeadSurvived}/${HEAD.size}`);
  // "useful" = head buckets survive suppression AND median relative error < 10%
  if (firstUsefulN === null && Number(avgHeadSurvived) >= HEAD.size && medErr < 0.10) firstUsefulN = N;
}

console.log("");
if (firstUsefulN !== null) {
  console.log(`VERDICT: useful aggregate signal emerges at N≈${firstUsefulN} contributing devices ` +
    `(head buckets survive k=${K} suppression and median rel-err < 10%). ` +
    `C2 is viable as opt-in, witnessed, local-DP — but only above this population floor.`);
} else {
  console.log(`VERDICT: at no tested population does the noised+suppressed aggregate reach <10% ` +
    `median error on head buckets. Honest call: do NOT ship outward intel; keep zero-egress ` +
    `as a permanent product virtue and rely on C1 on-device precision.`);
}
