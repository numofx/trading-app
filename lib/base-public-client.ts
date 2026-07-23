import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

const DEFAULT_BASE_RPC_URL = "https://sepolia.base.org";

export function getBaseRpcUrl() {
  return process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
}

/**
 * The chain every wallet interaction targets, driven by NEXT_PUBLIC_MATCHING_CHAIN_ID
 * (8453 = Base mainnet). Defaults to Base Sepolia when unset, matching the rest of the
 * app's testnet fallbacks.
 */
export function getAppChain() {
  const configured = Number(process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID?.trim() || "");
  return configured === base.id ? base : baseSepolia;
}

export function createBasePublicClient() {
  return createPublicClient({
    chain: getAppChain(),
    transport: http(getBaseRpcUrl()),
  });
}
