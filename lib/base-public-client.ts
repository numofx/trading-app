import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const DEFAULT_BASE_RPC_URL = "https://sepolia.base.org";

export function getBaseRpcUrl() {
  return process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
}

export function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(getBaseRpcUrl()),
  });
}
