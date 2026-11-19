import { expect, test } from "bun:test";
import { base, baseSepolia } from "viem/chains";
import { getBaseRpcUrls } from "./base-public-client.ts";

const KEYED = "https://base-mainnet.g.alchemy.com/v2/test-key";

test("reads go to the keyed endpoint first, then the chain's public one", () => {
  expect(getBaseRpcUrls(KEYED, base)).toEqual([
    KEYED,
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
  ]);
});

test("without a keyed endpoint, the public one alone", () => {
  const PUBLIC = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
  expect(getBaseRpcUrls(undefined, base)).toEqual(PUBLIC);
  expect(getBaseRpcUrls("  ", base)).toEqual(PUBLIC);
});

test("a keyed endpoint that is the public one is not listed twice", () => {
  for (const keyed of ["https://mainnet.base.org", "https://base-rpc.publicnode.com"]) {
    expect(getBaseRpcUrls(keyed, base)).toEqual([
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
    ]);
  }
});

test("on Sepolia the fallback is Sepolia's public endpoint, never mainnet's", () => {
  expect(getBaseRpcUrls(undefined, baseSepolia)).toEqual(["https://sepolia.base.org"]);
});
