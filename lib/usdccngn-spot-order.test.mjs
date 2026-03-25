import { test, expect } from "bun:test";
import { engineToUISpotOrder, uiToEngineSpotOrder } from "./usdccngn-spot-order.ts";

test("ui BUY maps to engine SELL with conserved value", () => {
  const translated = uiToEngineSpotOrder({
    price: 1605.25,
    side: "buy",
    size: 100,
  });

  expect(translated.engine.side).toBe("sell");
  expect(translated.engine.price).toBeCloseTo(1 / 1605.25, 12);
  expect(translated.engine.amount).toBeCloseTo(160525, 9);
  expect(translated.deltas.usdc).toBe(100);
  expect(translated.deltas.cngn).toBe(-160525);
  expect(translated.engine.amount * translated.engine.price).toBeCloseTo(100, 9);
});

test("ui SELL round-trips through engine form", () => {
  const translated = uiToEngineSpotOrder({
    price: 1605.25,
    side: "sell",
    size: 250,
  });
  const roundTrip = engineToUISpotOrder(translated.engine);

  expect(translated.engine.side).toBe("buy");
  expect(translated.deltas.usdc).toBe(-250);
  expect(translated.deltas.cngn).toBe(401312.5);
  expect(roundTrip.side).toBe("sell");
  expect(roundTrip.price).toBeCloseTo(1605.25, 9);
  expect(roundTrip.size).toBeCloseTo(250, 9);
});
