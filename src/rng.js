// 乱数（mulberry32）。同じ seed から同じ列を再現するため、Math.random は使わない。

/** 複数の整数から 32bit seed を作る（FNV-1a 風）。 */
export function mixSeed(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Number(n) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
