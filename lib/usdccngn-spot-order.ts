import type { MarketDefinition, SpotOrderTranslation } from "@/lib/trading.types";

const ROUND_TRIP_TOLERANCE = 1e-9;

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
}

function assertWithinTolerance(expected: number, actual: number, label: string) {
  const tolerance = Math.max(ROUND_TRIP_TOLERANCE, Math.abs(expected) * ROUND_TRIP_TOLERANCE);

  if (Math.abs(expected - actual) > tolerance) {
    throw new Error(`${label} mismatch exceeds tolerance`);
  }
}

export function isUSDCCNGNSpotMarket(market: MarketDefinition) {
  return market.type === "spot" && market.pair === "USDCcNGN";
}

export function uiToEngineSpotOrder(ui: SpotOrderTranslation["ui"]): SpotOrderTranslation {
  assertPositive(ui.price, "price");
  assertPositive(ui.size, "size");

  const enginePrice = 1 / ui.price;
  const engineAmount = ui.size * ui.price;
  const engineSide = ui.side === "buy" ? "sell" : "buy";
  const usdcDelta = ui.side === "buy" ? ui.size : -ui.size;
  const cngnDelta = -engineAmount * Math.sign(usdcDelta);

  assertPositive(enginePrice, "engine price");
  assertPositive(engineAmount, "engine amount");
  assertWithinTolerance(ui.size, engineAmount * enginePrice, "notional");

  return {
    ui,
    engine: {
      amount: engineAmount,
      price: enginePrice,
      side: engineSide,
    },
    deltas: {
      cngn: cngnDelta,
      usdc: usdcDelta,
    },
  };
}

export function engineToUISpotOrder(engine: SpotOrderTranslation["engine"]): SpotOrderTranslation["ui"] {
  assertPositive(engine.price, "engine price");
  assertPositive(engine.amount, "engine amount");

  const uiPrice = 1 / engine.price;
  const uiSize = engine.amount * engine.price;
  const uiSide = engine.side === "buy" ? "sell" : "buy";

  assertPositive(uiPrice, "ui price");
  assertPositive(uiSize, "ui size");
  assertWithinTolerance(uiSize, engine.amount * engine.price, "round-trip notional");

  return {
    price: uiPrice,
    side: uiSide,
    size: uiSize,
  };
}
