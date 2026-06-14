import { makeRng, type Rng } from "./prng.js";

interface Beta { alpha: number; beta: number; }
type State = Record<string, Record<string, Beta>>; // bucket -> advertiserId -> Beta

// Deterministic Gamma(k,1) approx via Marsaglia-Tsang, then Beta(a,b) =
// G(a)/(G(a)+G(b)). Seeded → reproducible sampling.
function sampleGamma(shape: number, rng: Rng): number {
  let s = shape;
  let boost = 1;
  if (s < 1) {
    const u = (rng.nextU32() + 1) / 4294967297;
    boost = Math.pow(u, 1 / s);
    s += 1;
  }
  const d = s - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    // approximate a standard normal via Box-Muller from two seeded uniforms
    const u1 = (rng.nextU32() + 1) / 4294967297;
    const u2 = (rng.nextU32() + 1) / 4294967297;
    const x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = (rng.nextU32() + 1) / 4294967297;
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v * boost;
    }
  }
}
function sampleBeta(a: number, b: number, rng: Rng): number {
  const ga = sampleGamma(a, rng);
  const gb = sampleGamma(b, rng);
  return ga / (ga + gb);
}

export class SolverBandit {
  private state: State = {};
  private rng: Rng;
  constructor(seed: bigint) {
    this.rng = makeRng(seed);
  }

  private slot(bucket: string, adv: string): Beta {
    this.state[bucket] ??= {};
    this.state[bucket][adv] ??= { alpha: 1, beta: 1 };
    return this.state[bucket][adv];
  }

  update(bucket: string, adv: string, reward: boolean): void {
    const s = this.slot(bucket, adv);
    if (reward) s.alpha += 1;
    else s.beta += 1;
  }

  rank(bucket: string, advertiserIds: string[]): string[] {
    const scored = advertiserIds.map((id) => {
      const s = this.slot(bucket, id);
      return { id, score: sampleBeta(s.alpha, s.beta, this.rng) };
    });
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return scored.map((x) => x.id);
  }

  toJSON(): State { return JSON.parse(JSON.stringify(this.state)); }

  static fromJSON(seed: bigint, state: State): SolverBandit {
    const b = new SolverBandit(seed);
    b.state = JSON.parse(JSON.stringify(state));
    return b;
  }
}
