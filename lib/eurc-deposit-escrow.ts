import { getAddress, isAddress } from "viem";

/** What a trader sees when a EURC deposit is refused for any reason below. */
export const EURC_DEPOSITS_UNAVAILABLE = "EURC deposits temporarily unavailable";

export type EurcDepositEscrow =
  | { ok: true; escrow: `0x${string}` }
  | { ok: false; message: typeof EURC_DEPOSITS_UNAVAILABLE; reason: string };

/**
 * The escrow a EURC deposit may pay into: the venue's EURC-USDC `asset_address` and
 * `NEXT_PUBLIC_EURC_ASSET_ADDRESS`, when both are present and name the same contract (case-insensitive).
 *
 * Either alone is refused, never used as a fallback. The escrow is a CREATE address of the deployer, so
 * a build configured before the deploy, or a stale build after a redeploy, can name a contract the
 * venue does not credit, and a deposit there has no ledger entry and no way back. The venue alone is
 * not enough either: the app would then send funds wherever an unverified response pointed.
 */
export function resolveEurcDepositEscrow(
  listed: string | null | undefined,
  configured: string | null | undefined
): EurcDepositEscrow {
  const venue = listed?.trim() ?? "";
  const build = configured?.trim() ?? "";
  if (!isAddress(venue, { strict: false })) {
    return refuse(
      venue === ""
        ? "EURC-USDC is not listed by the venue"
        : `the venue's escrow ${venue} is not an address`
    );
  }
  if (!isAddress(build, { strict: false })) {
    return refuse(
      build === ""
        ? "NEXT_PUBLIC_EURC_ASSET_ADDRESS is not set"
        : `the configured escrow ${build} is not an address`
    );
  }
  if (venue.toLowerCase() !== build.toLowerCase()) {
    return refuse(`the venue lists ${venue}, this build is configured with ${build}`);
  }
  return { escrow: getAddress(build), ok: true };
}

function refuse(reason: string): EurcDepositEscrow {
  return { message: EURC_DEPOSITS_UNAVAILABLE, ok: false, reason };
}

/** The `/api/eurc-escrow` payload: `asset_address` is omitted when EURC-USDC is not listed. */
export type EurcEscrowResponse = { asset_address?: string };

/**
 * Reads the venue's EURC-USDC escrow through `/api/eurc-escrow`, uncached, at deposit time. Null
 * when it is not listed, the route fails, or the response is not the expected shape: all three
 * refuse the deposit, through resolveEurcDepositEscrow.
 */
export async function fetchListedEurcEscrow(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher("/api/eurc-escrow", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as EurcEscrowResponse | null;
    return typeof body?.asset_address === "string" ? body.asset_address : null;
  } catch {
    return null;
  }
}
