import type { Candle } from "@/lib/trading.types";

export type CandleSimulationOptions = {
  /** Probability that a tick rolls a new candle instead of updating the last one. */
  rollChance?: number;
  /** Multiplies drift and volatility; higher values produce larger moves per tick. */
  timeframeScale?: number;
};

export function getNextCandleTimeLabel(currentLabel: string) {
  if (currentLabel.includes(":")) {
    const [hoursString] = currentLabel.split(":");
    const hours = Number(hoursString);
    return `${String((hours + 1) % 24).padStart(2, "0")}:00`;
  }

  const [monthString, dayString] = currentLabel.split("-");

  if (!monthString || !dayString) {
    return currentLabel;
  }

  const nextDay = Number(dayString) + 1;
  return `${monthString}-${String(nextDay).padStart(2, "0")}`;
}

export function simulateLiveCandles(candles: Candle[], options: CandleSimulationOptions = {}) {
  const { rollChance = 0.28, timeframeScale = 1 } = options;
  const lastCandle = candles.at(-1);

  if (!lastCandle) {
    return candles;
  }

  const precision = 2;
  const drift = 0.28 * timeframeScale;
  const volatility = 0.42 * timeframeScale;
  const directionalBias = Math.random() > 0.5 ? drift : -drift;
  const delta = directionalBias + (Math.random() - 0.5) * volatility;
  const nextClose = Number((lastCandle.close + delta).toFixed(precision));
  const nextHigh = Number(
    (Math.max(lastCandle.high, nextClose) + Math.random() * volatility * 0.3).toFixed(precision)
  );
  const nextLow = Number(
    (Math.min(lastCandle.low, nextClose) - Math.random() * volatility * 0.3).toFixed(precision)
  );
  const nextVolume = Math.max(
    1,
    Math.round(lastCandle.volume + (Math.random() - 0.5) * lastCandle.volume * 0.18)
  );

  const updatedCurrent = {
    ...lastCandle,
    close: nextClose,
    high: nextHigh,
    low: nextLow,
    volume: nextVolume,
  } satisfies Candle;

  if (Math.random() < rollChance) {
    const nextOpen = nextClose;
    const seededClose = Number((nextOpen + (Math.random() - 0.5) * volatility).toFixed(precision));
    const nextCandle = {
      close: seededClose,
      high: Number(
        (Math.max(nextOpen, seededClose) + Math.random() * volatility * 0.35).toFixed(precision)
      ),
      low: Number(
        (Math.min(nextOpen, seededClose) - Math.random() * volatility * 0.35).toFixed(precision)
      ),
      open: nextOpen,
      time: getNextCandleTimeLabel(lastCandle.time),
      volume: Math.max(1, Math.round(lastCandle.volume * (0.88 + Math.random() * 0.24))),
    } satisfies Candle;

    return [...candles.slice(1, -1), updatedCurrent, nextCandle];
  }

  return [...candles.slice(0, -1), updatedCurrent];
}
