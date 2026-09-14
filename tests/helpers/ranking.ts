/**
 * Ranking and chance, for the measurements that ask whether a score said
 * anything about the returns that followed.
 *
 * Shared rather than imported from one test by another: a test file imported
 * for its functions registers its own suites in the importer too, and the
 * quality-score backtest appeared, skipped, inside the growth-yield one.
 */

/** Spearman's rank correlation: Pearson's, computed on the ranks. */
export function spearman(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 4) return null;
  const rank = (values: number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length);
    for (let at = 0; at < order.length;) {
      let end = at;
      while (end + 1 < order.length && order[end + 1].value === order[at].value) end++;
      const shared = (at + end) / 2 + 1;
      for (let index = at; index <= end; index++) ranks[order[index].index] = shared;
      at = end + 1;
    }
    return ranks;
  };
  const left = rank(pairs.map((pair) => pair[0]));
  const right = rank(pairs.map((pair) => pair[1]));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanLeft = mean(left), meanRight = mean(right);
  let top = 0, leftSquares = 0, rightSquares = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] - meanLeft, b = right[index] - meanRight;
    top += a * b; leftSquares += a * a; rightSquares += b * b;
  }
  return leftSquares && rightSquares ? top / Math.sqrt(leftSquares * rightSquares) : null;
}

/**
 * How often chance alone would have done this well.
 *
 * A rank correlation of 0.14 is a number, not a finding. The companies in a
 * cohort all rise and fall with the same market, so the usual table of
 * significance does not apply; what does is shuffling. Deal the same scores
 * out at random within each cohort, keep the returns where they are, pool the
 * ranks exactly as the measurement does, and see how often the shuffle beats
 * what the score actually achieved.
 *
 * A deterministic generator, because a measurement whose answer moves between
 * runs is a measurement nobody can check.
 */
export function shuffleTest(
  cohorts: Array<Array<[number, number]>>,
  observed: number,
  rounds = 2_000,
): number {
  let seed = 0x2f6e2b1;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
  let beaten = 0;
  for (let round = 0; round < rounds; round++) {
    const pooled: Array<[number, number]> = [];
    for (const cohort of cohorts) {
      const scores = cohort.map((pair) => pair[0]);
      for (let at = scores.length - 1; at > 0; at--) {
        const swap = Math.floor(random() * (at + 1));
        [scores[at], scores[swap]] = [scores[swap], scores[at]];
      }
      cohort.forEach((pair, index) => pooled.push([scores[index], pair[1]]));
    }
    const rho = spearman(pooled);
    if (rho != null && rho >= observed) beaten += 1;
  }
  return beaten / rounds;
}

/**
 * The same test, but harder, and the one worth quoting.
 *
 * The lenient shuffle deals scores out afresh in every cohort, which pretends
 * the cohorts are independent. They are not: the same thirty-five companies
 * appear in all of them, a company scoring well in 2016 scores well in 2017,
 * and five-year returns from consecutive years overlap by four. Two hundred
 * and twenty-seven observations are nothing like two hundred and twenty-seven
 * independent ones, so that test reports a smaller number than it has earned.
 *
 * This one permutes the companies once and applies the same permutation to
 * every cohort — the score of Costco follows Chevron's returns in all seven
 * years, not in one. Everything the lenient test breaks is preserved: the
 * persistence of the scores, the overlap of the returns, the market they
 * shared. What remains is the only question that matters — whether the score
 * belongs to the company whose returns it is being credited with.
 */
export function companyShuffleTest(
  cohorts: Array<Array<{ ticker: string; score: number; returnRank: number }>>,
  observed: number,
  rounds = 2_000,
): { p: number; companies: number } | null {
  const common = cohorts.reduce<string[] | null>((kept, cohort) => {
    const here = new Set(cohort.map((entry) => entry.ticker));
    return kept == null ? [...here] : kept.filter((ticker) => here.has(ticker));
  }, null) ?? [];
  if (common.length < 8 || cohorts.length < 2) return null;

  let seed = 0x5bd1e995;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };

  // Ranked within the cohort, over the companies every cohort shares, so the
  // observed figure and the shuffled ones are measured on the same footing.
  const ranked = cohorts.map((cohort) => {
    const kept = cohort.filter((entry) => common.includes(entry.ticker));
    const scores = [...kept].sort((a, b) => a.score - b.score).map((entry) => entry.score);
    return new Map(kept.map((entry) => [entry.ticker, {
      score: scores.indexOf(entry.score) / Math.max(1, scores.length - 1),
      returnRank: entry.returnRank,
    }]));
  });

  const pooledFor = (assign: Map<string, string>) => {
    const pooled: Array<[number, number]> = [];
    for (const cohort of ranked) {
      for (const [ticker, entry] of cohort) {
        const lent = cohort.get(assign.get(ticker) ?? ticker);
        if (lent) pooled.push([lent.score, entry.returnRank]);
      }
    }
    return spearman(pooled);
  };

  const straight = pooledFor(new Map()) ?? observed;
  let beaten = 0;
  for (let round = 0; round < rounds; round++) {
    const shuffled = [...common];
    for (let at = shuffled.length - 1; at > 0; at--) {
      const swap = Math.floor(random() * (at + 1));
      [shuffled[at], shuffled[swap]] = [shuffled[swap], shuffled[at]];
    }
    const assign = new Map(common.map((ticker, index) => [ticker, shuffled[index]]));
    const rho = pooledFor(assign);
    if (rho != null && rho >= straight) beaten += 1;
  }
  return { p: beaten / rounds, companies: common.length };
}
