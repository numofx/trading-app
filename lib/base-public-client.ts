import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

/**
 * Last-resort fallback only. The public endpoint is shared and aggressively throttled — a rate
 * limit there is what silently emptied the wallet balance reads — so every deployment sets
 * NEXT_PUBLIC_BASE_RPC_URL to the venue's keyed Alchemy endpoint instead.
 */
const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

export function getBaseRpcUrl() {
  return process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
}

/**
 * The chain every wallet interaction targets, driven by NEXT_PUBLIC_MATCHING_CHAIN_ID.
 *
 * Base mainnet unless Sepolia (84532) is asked for by name. The default used to be Sepolia, which
 * meant a missing or fat-fingered env quietly pointed the app at a testnet whose contracts do not
 * exist on mainnet — the wrong direction to fail in for a venue that is live on 8453.
 */
export function getAppChain() {
  const configured = Number(process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID?.trim() || "");
  return configured === baseSepolia.id ? baseSepolia : base;
}

export function createBasePublicClient() {
  return createPublicClient({
    chain: getAppChain(),
    transport: http(getBaseRpcUrl()),
  });
}
