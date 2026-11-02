/**
 * Black-76 as MarginEngine v2 marks an option: on the forward, undiscounted, with time in seconds over a
 * 365-day year. Calling this year 365.25 days disagrees with the engine's own mark on every strike.
 */
const SECONDS_PER_YEAR = 31_536_000;
const MIN_VOL = 0.0001;
const MAX_VOL = 10;
const SOLVER_STEPS = 80;

export type Black76Option = {
  forward: number;
  strike: number;
  isCall: boolean;
  /** Time to expiry. */
  seconds: number;
};

/** The standard normal CDF (Abramowitz & Stegun 26.2.17, accurate to 1e-7: a displayed vol needs no more). */
function normalCdf(x: number) {
  const t = 1 / (1 + 0.231_641_9 * Math.abs(x));
  const series =
    t *
    (0.319_381_53 +
      t * (-0.356_563_782 + t * (1.781_477_937 + t * (-1.821_255_978 + t * 1.330_274_429))));
  const tail = (Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) * series;
  return x >= 0 ? 1 - tail : tail;
}

function isPriceable({ forward, seconds, strike }: Black76Option) {
  return forward > 0 && strike > 0 && seconds > 0;
}

export function black76Price(option: Black76Option, vol: number) {
  const { forward, isCall, strike } = option;
  const deviation = vol * Math.sqrt(option.seconds / SECONDS_PER_YEAR);
  const d1 = (Math.log(forward / strike) + (deviation * deviation) / 2) / deviation;
  const d2 = d1 - deviation;
  return isCall
    ? forward * normalCdf(d1) - strike * normalCdf(d2)
    : strike * normalCdf(-d2) - forward * normalCdf(-d1);
}

/**
 * The annualised vol a premium implies, or null when no vol can produce it: nothing to price, a premium at
 * or below intrinsic value, or one beyond any sensible vol. Bisection, since a price is monotonic in vol.
 */
export function impliedVol(option: Black76Option, premium: number | null): number | null {
  if (premium === null || !(premium > 0) || !isPriceable(option)) {
    return null;
  }
  if (premium <= black76Price(option, MIN_VOL) || premium >= black76Price(option, MAX_VOL)) {
    return null;
  }
  let low = MIN_VOL;
  let high = MAX_VOL;
  for (let step = 0; step < SOLVER_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (black76Price(option, middle) < premium) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}
