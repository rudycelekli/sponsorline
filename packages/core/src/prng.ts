const MASK64 = (1n << 64n) - 1n;

export interface Rng {
  nextU32(): number;
  nextInt(n: number): number;
}

export function makeRng(seed: bigint): Rng {
  let state = seed & MASK64;
  function next64(): bigint {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    z = z ^ (z >> 31n);
    return z & MASK64;
  }
  return {
    nextU32() {
      return Number(next64() >> 32n); // top 32 bits, 0 .. 2^32-1
    },
    nextInt(n: number) {
      if (n <= 0) throw new Error("nextInt requires n > 0");
      return this.nextU32() % n;
    },
  };
}
