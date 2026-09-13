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
 * USDC was paused by default while deposits landed in the corrupted CashAsset. They now land in the
 * token-backed wrapped USDC escrow, so mainnet opens both currencies unless told otherwise.
 */
test("nothing is paused on mainnet by default", () => {
  withEnv(
    {
      NEXT_PUBLIC_MATCHING_CHAIN_ID: BASE_MAINNET_CHAIN_ID,
      NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES: undefined,
    },
    () => {
      expect(getDepositPauseReason("USDC")).toBeNull();
      expect(getDepositPauseReason("cNGN")).toBeNull();
      expect(getFirstDepositableCurrency()).toBe("USDC");
    }
  );
});

test("a currency can be paused by env", () => {
  withEnv(
    {
      NEXT_PUBLIC_MATCHING_CHAIN_ID: BASE_MAINNET_CHAIN_ID,
      NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES: "USDC",
    },
    () => {
      expect(getDepositPauseReason("USDC")).toContain("USDC deposits are paused");
      expect(getDepositPauseReason("cNGN")).toBeNull();
      expect(getFirstDepositableCurrency()).toBe("cNGN");
    }
  );
});

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

test("none reopens everything", () => {
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
