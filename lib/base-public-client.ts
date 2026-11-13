import { createPublicClient, fallback, http } from "viem";
import { base, baseSepolia } from "viem/chains";

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

/**
 * The RPC URLs reads go to, in order: the keyed endpoint (NEXT_PUBLIC_BASE_RPC_URL), then the
 * chain's public endpoint (mainnet.base.org, or sepolia.base.org).
 *
 * The public endpoint is shared and aggressively throttled, so it is never the primary: a rate
 * limit there is what once silently emptied the wallet balance reads. It is the fallback because
 * the keyed endpoint can fail as a whole: on 2026-11-12 the Alchemy plan hit its monthly cap and
 * every read 429'd, leaving balances, the trading account and margin blank until it was raised.
 */
export function getBaseRpcUrls(
  configured = process.env.NEXT_PUBLIC_BASE_RPC_URL,
  chain = getAppChain()
): string[] {
  const publicUrl = chain.rpcUrls.default.http[0];
  const keyed = configured?.trim();
  return keyed && keyed !== publicUrl ? [keyed, publicUrl] : [publicUrl];
}

/**
 * A read client that moves on to the next RPC URL when one fails. viem's `fallback` gives each URL
 * no retries of its own, so a 429 moves on at once, and it throws a revert rather than asking the
 * next URL the same question.
 */
export function createBasePublicClient() {
  const chain = getAppChain();
  return createPublicClient({
    chain,
    transport: fallback(
      getBaseRpcUrls(process.env.NEXT_PUBLIC_BASE_RPC_URL, chain).map((url) => http(url))
    ),
  });
}
