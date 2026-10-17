// Small seeded random number generator (mulberry32), so a run with the same --seed plans the same data.

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** Integer in [min, max], both included. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** Picks one entry of `items` with the matching weight (weights need not sum to 1; zero weights never win). */
    weighted(items, weights) {
      const total = weights.reduce((sum, w) => sum + w, 0);
      let x = next() * total;
      for (let i = 0; i < items.length; i++) {
        x -= weights[i];
        if (x < 0 && weights[i] > 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
  return rng;
}
