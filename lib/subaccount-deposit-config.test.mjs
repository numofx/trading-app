import { expect, test } from "bun:test";
import { getDepositableCurrencies, getDepositAddresses } from "./subaccount-deposit-config.ts";

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
