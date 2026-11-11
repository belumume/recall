// FSRS-6, the scheduler modern Anki uses, written to give exactly the same
// results as the Python library py-fsrs 6.3.2 with no learning steps
// (every answer goes straight to a whole-day interval).
//
// It also copies Python's random numbers, so the small random spread FSRS adds
// to intervals ("fuzz") lands on the same day in both. test/parity.test.mjs
// checks this against answers produced by Python.

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const RATING_NAMES = { 1: "again", 2: "hard", 3: "good", 4: "easy" };
export const State = { Learning: 1, Review: 2, Relearning: 3 };

export const DEFAULT_PARAMETERS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
];
const STABILITY_MIN = 0.001;
const DAY_MS = 86400000;
const FUZZ_RANGES = [
  { start: 2.5, end: 7.0, factor: 0.15 },
  { start: 7.0, end: 20.0, factor: 0.1 },
  { start: 20.0, end: Infinity, factor: 0.05 },
];

// Python's round() sends halves to the even neighbour: round(2.5) is 2.
export function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// Python computes math.e ** x with pow, not exp; use the same to match it bit for bit.
const ePow = (x) => Math.pow(Math.E, x);

export class Scheduler {
  constructor({ parameters = DEFAULT_PARAMETERS, desiredRetention = 0.9, maximumInterval = 36500 } = {}) {
    this.w = parameters;
    this.desiredRetention = desiredRetention;
    this.maximumInterval = maximumInterval;
    this.decay = -this.w[20];
    this.factor = Math.pow(0.9, 1 / this.decay) - 1;
  }

  clampD(d) { return Math.min(Math.max(d, 1), 10); }
  clampS(s) { return Math.max(s, STABILITY_MIN); }

  initialStability(r) { return this.clampS(this.w[r - 1]); }

  initialDifficulty(r, clamp) {
    const d = this.w[4] - ePow(this.w[5] * (r - 1)) + 1;
    return clamp ? this.clampD(d) : d;
  }

  // Chance of remembering the card now (0 to 1).
  retrievability(card, nowMs) {
    if (card.last_review == null || card.stability == null) return 0;
    const elapsed = Math.max(0, Math.floor((nowMs - Date.parse(card.last_review)) / DAY_MS));
    return Math.pow(1 + this.factor * elapsed / card.stability, this.decay);
  }

  // Days until the chance of remembering falls to the target (90%).
  nextInterval(s) {
    let i = (s / this.factor) * (Math.pow(this.desiredRetention, 1 / this.decay) - 1);
    i = pyRound(i);
    return Math.min(Math.max(i, 1), this.maximumInterval);
  }

  shortTermStability(s, r) {
    let inc = ePow(this.w[17] * (r - 3 + this.w[18])) * Math.pow(s, -this.w[19]);
    if (r >= Rating.Hard) inc = Math.max(inc, 1.0);
    return this.clampS(s * inc);
  }

  nextDifficulty(d, r) {
    const target = this.initialDifficulty(Rating.Easy, false);
    const delta = -(this.w[6] * (r - 3));
    const damped = d + (10.0 - d) * delta / 9.0;
    return this.clampD(this.w[7] * target + (1 - this.w[7]) * damped);
  }

  nextStability(d, s, retr, r) {
    let next;
    if (r === Rating.Again) {
      const longTerm = this.w[11] * Math.pow(d, -this.w[12]) *
        (Math.pow(s + 1, this.w[13]) - 1) * ePow((1 - retr) * this.w[14]);
      const shortTerm = s / ePow(this.w[17] * this.w[18]);
      next = Math.min(longTerm, shortTerm);
    } else {
      const hardPenalty = r === Rating.Hard ? this.w[15] : 1;
      const easyBonus = r === Rating.Easy ? this.w[16] : 1;
      next = s * (1 + ePow(this.w[8]) * (11 - d) * Math.pow(s, -this.w[9]) *
        (ePow((1 - retr) * this.w[10]) - 1) * hardPenalty * easyBonus);
    }
    return this.clampS(next);
  }

  fuzzRange(days) {
    let delta = 1.0;
    for (const f of FUZZ_RANGES) delta += f.factor * Math.max(Math.min(days, f.end) - f.start, 0.0);
    let lo = pyRound(days - delta);
    let hi = pyRound(days + delta);
    lo = Math.max(2, lo);
    hi = Math.min(hi, this.maximumInterval);
    lo = Math.min(lo, hi);
    return [lo, hi];
  }

  // One review. `card` is the dict py-fsrs stores (state.json), or null for a
  // new card. `random` is a function returning numbers in [0, 1).
  // Returns the new card dict; due and last_review are ISO strings.
  review(card, rating, whenMs, random) {
    const c = card ? { ...card } : { card_id: whenMs, state: State.Learning, step: 0,
      stability: null, difficulty: null, due: null, last_review: null };
    const sinceLast = c.last_review ? Math.floor((whenMs - Date.parse(c.last_review)) / DAY_MS) : null;
    if (c.stability == null || c.difficulty == null) {
      c.stability = this.initialStability(rating);
      c.difficulty = this.initialDifficulty(rating, true);
    } else {
      if (sinceLast !== null && sinceLast < 1) {
        c.stability = this.shortTermStability(c.stability, rating);
      } else {
        c.stability = this.nextStability(c.difficulty, c.stability,
          this.retrievability(c, whenMs), rating);
      }
      c.difficulty = this.nextDifficulty(c.difficulty, rating);
    }
    // No learning or relearning steps: every card is in Review after an answer.
    c.state = State.Review;
    c.step = null;
    let days = this.nextInterval(c.stability);
    if (days >= 2.5) {
      const [lo, hi] = this.fuzzRange(days);
      days = Math.min(pyRound(random() * (hi - lo + 1) + lo), this.maximumInterval);
    }
    c.due = new Date(whenMs + days * DAY_MS).toISOString();
    c.last_review = new Date(whenMs).toISOString();
    return c;
  }
}

// ---------------------------------------------------------------- Python's random

// Python seeds its Mersenne Twister from a string by joining the string's bytes
// and their SHA-512 hash into one big number. pythonRandom(seed) returns a
// function giving the same sequence as random.random() after random.seed(seed).
export async function pythonRandom(seed) {
  const bytes = new TextEncoder().encode(seed);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
  const all = new Uint8Array(bytes.length + hash.length);
  all.set(bytes);
  all.set(hash, bytes.length);
  // The big number's 32-bit words, least significant first.
  const key = [];
  for (let end = all.length; end > 0; end -= 4) {
    let word = 0;
    for (let i = Math.max(0, end - 4); i < end; i++) word = (word * 256 + all[i]) >>> 0;
    key.push(word);
  }
  while (key.length > 1 && key[key.length - 1] === 0) key.pop();
  const mt = new MersenneTwister(key);
  return () => {
    const a = mt.next() >>> 5;
    const b = mt.next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  };
}

class MersenneTwister {
  constructor(key) {
    this.mt = new Uint32Array(624);
    this.i = 625;
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1, j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.i = 624;
  }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(prev, 1812433253) + i) >>> 0;
    }
  }

  next() {
    const mt = this.mt;
    if (this.i >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.i = 0;
    }
    let y = mt[this.i++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
}
