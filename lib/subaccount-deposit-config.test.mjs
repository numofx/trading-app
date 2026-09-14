import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { getWithdrawalModuleAddress } from "./subaccount-deposit-config.ts";
import {
  getDepositableCurrencies,
  getDepositAddresses,
  getMatchingAddress,
  getQuoteAssetAddress,
  getTradeModuleAddress,
  getUsdcCngnManagerAddress,
} from "./subaccount-deposit-config.ts";

const BASE_MAINNET_CHAIN_ID = "8453";
const BASE_SEPOLIA_CHAIN_ID = "84532";

/** getAppChain() reads the env on every call, so each test picks its own chain. */
function withChain(chainId, run) {
  const previous = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID;
  process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = chainId;

  try {
    run();
  } finally {
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = previous;
  }
}

test("cNGN deposits target the wrapped cNGN asset, not the cNGN token", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const addresses = getDepositAddresses("cNGN");

    // The escrow contract the wallet approves and deposits into. Verified on Base mainnet:
    // wrappedAsset() returns the token below, and it is the spot market's asset_address.
    expect(addresses.baseAssetContract).toBe("0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493");
    expect(addresses.token).toBe("0x46C85152bFe9f96829aA94755D9f915F9B10EF5F");
  });
});

/**
 * The pairing is the point: Base Sepolia hosts a second contract also called cNGN
 * (0xe2387F…, 6 decimals) that this escrow does not wrap. Approving that one produces a deposit
 * that cannot settle, so the escrow and its token must come from the same artifact.
 */
test("Sepolia cNGN deposits use the token that escrow actually wraps", () => {
  withChain(BASE_SEPOLIA_CHAIN_ID, () => {
    const addresses = getDepositAddresses("cNGN");

    expect(addresses.baseAssetContract).toBe("0x1c08f30c204EE18EbBDc161c0f0864AFb826934b");
    expect(addresses.token).toBe("0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6");
    expect(addresses.token).not.toBe("0xe2387F04d3858e7Cb64Ef5Ed6617f9B2fcEEAfa2");
  });
});

test("USDC and cNGN deposits differ only in escrow and token", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const usdc = getDepositAddresses("USDC");
    const cngn = getDepositAddresses("cNGN");

    expect(usdc.manager).toBe(cngn.manager);
    expect(usdc.subaccountCreator).toBe(cngn.subaccountCreator);
    expect(usdc.baseAssetContract).not.toBe(cngn.baseAssetContract);
    expect(usdc.token).not.toBe(cngn.token);
  });
});

test("both currencies are offered on either chain", () => {
  for (const chainId of [BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID]) {
    withChain(chainId, () => {
      expect(getDepositableCurrencies()).toEqual(["USDC", "cNGN"]);
    });
  }
});

/**
 * The whole matching stack moves with the chain, not just the assets. Every mainnet address here
 * is verified against Base 8453: `matching` is the contract the venue's own trades are submitted
 * to, `subaccountCreator` answers to `createAndDepositSubAccount(address,uint256,address)`, and
 * the manager, trade module and USDC escrow are the SRM stack spot settles on since 2026-09-10.
 *
 * None of the Sepolia addresses have code on mainnet, so a stack that half-flips is not a
 * degraded app — it is transactions built against contracts that do not exist.
 */
test("mainnet USDC deposits target the wrapped USDC escrow under the SRM", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const addresses = getDepositAddresses("USDC");

    expect(addresses.baseAssetContract).toBe("0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84");
    expect(addresses.token).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(addresses.manager).toBe("0x3195Bd7e02d93982bCF8b34DF5B941fFCaE1E49b");
    expect(addresses.subaccountCreator).toBe("0x568890A8D63Ba8a03b6eCbEedA1bD9f6ea014D5D");
    expect(getMatchingAddress()).toBe("0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191");
  });
});

/**
 * The three move as one, because they did on chain. Matching disallowed the CashAsset-quoted
 * module `0x4481…eD1c`, markets-service rejects any order signed for another module, the new
 * module's `quoteAsset()` is the wrapped USDC escrow, and the settlement vault reverts on accounts
 * under the retired DeliverableFXManager. Any one left behind is an order that cannot settle.
 */
test("mainnet trades through the wrapped-quote module, settling USDC in the deposit escrow", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    expect(getTradeModuleAddress()).toBe("0x12423B366F6F07130961900bE00d05Ea63Acd071");
    expect(getQuoteAssetAddress()).toBe(getDepositAddresses("USDC").baseAssetContract);
    expect(getUsdcCngnManagerAddress()).not.toBe("0xcE01f3D74400caE39bd7608cd2d286C2e3874d49");
  });
});

test("the Sepolia stack stays behind an explicit chain id", () => {
  withChain(BASE_SEPOLIA_CHAIN_ID, () => {
    const addresses = getDepositAddresses("USDC");

    expect(addresses.baseAssetContract).toBe("0xdC3f31B61a2128B3D1ECB8b6f6d0DE82eBd6c7Ae");
    expect(addresses.token).toBe("0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110");
    expect(getMatchingAddress()).toBe("0x1599636347FD5bA1fBE21D58AfE0b8B9cbe283FF");
  });
});

/** An unset chain id must not quietly land on the testnet stack, which is how this broke before. */
test("no chain id configured means Base mainnet", () => {
  withChain(undefined, () => {
    expect(getMatchingAddress()).toBe("0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191");
  });
});

/** From contracts/execution/deployments/<chain>/matching.json; allowed on each chain's Matching. */
test("the withdrawal module is the one deployed beside each chain's Matching", () => {
  const previousChain = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID;
  const previousOverride = process.env.NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS;
  try {
    delete process.env.NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS;
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = "8453";
    expect(getWithdrawalModuleAddress()).toBe(getAddress("0x0a10AE2f5D2482cE1e43bC309D430B8861C2b5aB"));
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = "84532";
    expect(getWithdrawalModuleAddress()).toBe(getAddress("0xfdDb0D00Df6d1569E46e72D35e7B6CEE4Bb7F9FB"));
  } finally {
    process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID = previousChain;
    if (previousOverride === undefined) {
      delete process.env.NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS;
    } else {
      process.env.NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS = previousOverride;
    }
  }
});
