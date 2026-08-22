import { expect, test } from "bun:test";
import {
  getDepositPauseReason,
  getFirstDepositableCurrency,
} from "./subaccount-deposit-config.ts";

const BASE_MAINNET_CHAIN_ID = "8453";
const BASE_SEPOLIA_CHAIN_ID = "84532";

function withEnv(env, run) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * The reason this exists: on mainnet a USDC deposit lands in a CashAsset that cannot pay it back —
 * the escrow holds 0.000001 USDC against a 1.368e40 claim. Taking money into a one-way door is the
 * failure being prevented.
 */
test("USDC deposits are closed on mainnet and cNGN is not", () => {
  withEnv(
    {
      NEXT_PUBLIC_MATCHING_CHAIN_ID: BASE_MAINNET_CHAIN_ID,
      NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES: undefined,
    },
    () => {
      expect(getDepositPauseReason("USDC")).toContain("USDC deposits are paused");
      expect(getDepositPauseReason("cNGN")).toBeNull();
      expect(getFirstDepositableCurrency()).toBe("cNGN");
    }
  );
});

/** Sepolia's escrow is a different, healthy contract, so nothing is paused there. */
test("Sepolia is unaffected", () => {
  withEnv(
    {
      NEXT_PUBLIC_MATCHING_CHAIN_ID: BASE_SEPOLIA_CHAIN_ID,
      NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES: undefined,
    },
    () => {
      expect(getDepositPauseReason("USDC")).toBeNull();
      expect(getFirstDepositableCurrency()).toBe("USDC");
    }
  );
});

/** The way back: reopen without a code change once the escrow is made whole. */
test("the pause can be lifted by env", () => {
  withEnv(
    {
      NEXT_PUBLIC_MATCHING_CHAIN_ID: BASE_MAINNET_CHAIN_ID,
      NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES: "none",
    },
    () => {
      expect(getDepositPauseReason("USDC")).toBeNull();
      expect(getFirstDepositableCurrency()).toBe("USDC");
    }
  );
});

test("and extended to another currency if a second escrow goes bad", () => {
  withEnv(
    {
      NEXT_PUBLIC_MATCHING_CHAIN_ID: BASE_MAINNET_CHAIN_ID,
      NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES: "USDC, cNGN",
    },
    () => {
      expect(getDepositPauseReason("USDC")).not.toBeNull();
      expect(getDepositPauseReason("cNGN")).not.toBeNull();
      // Nothing is depositable, so the form still needs something to render.
      expect(getFirstDepositableCurrency()).toBe("USDC");
    }
  );
});
