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
    expect(addresses?.baseAssetContract).toBe("0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493");
    expect(addresses?.token).toBe("0x46C85152bFe9f96829aA94755D9f915F9B10EF5F");
  });
});

test("USDC and cNGN deposits differ only in escrow and token", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    const usdc = getDepositAddresses("USDC");
    const cngn = getDepositAddresses("cNGN");

    expect(usdc?.manager).toBe(cngn?.manager);
    expect(usdc?.subaccountCreator).toBe(cngn?.subaccountCreator);
    expect(usdc?.baseAssetContract).not.toBe(cngn?.baseAssetContract);
    expect(usdc?.token).not.toBe(cngn?.token);
  });
});

test("cNGN is unavailable off mainnet rather than falling back to a wrong address", () => {
  withChain(BASE_SEPOLIA_CHAIN_ID, () => {
    expect(getDepositAddresses("cNGN")).toBeNull();
    expect(getDepositAddresses("USDC")).not.toBeNull();
  });
});

test("only currencies with an escrow contract are offered", () => {
  withChain(BASE_MAINNET_CHAIN_ID, () => {
    expect(getDepositableCurrencies()).toEqual(["USDC", "cNGN"]);
  });

  withChain(BASE_SEPOLIA_CHAIN_ID, () => {
    expect(getDepositableCurrencies()).toEqual(["USDC"]);
  });
});
