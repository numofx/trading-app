/** A 32-byte transaction hash; anything else is never turned into a link. */
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRAILING_SLASH_PATTERN = /\/+$/;

/**
 * Where a transaction can be checked on the chain's explorer — Basescan on Base — or null when there is nothing
 * safe to link: no explorer, no hash, or a value that is not a transaction hash.
 */
export function getExplorerTransactionUrl(
  txHash: string | undefined,
  explorerUrl: string | undefined
) {
  if (explorerUrl === undefined || txHash === undefined || !TRANSACTION_HASH_PATTERN.test(txHash)) {
    return null;
  }
  return `${explorerUrl.replace(TRAILING_SLASH_PATTERN, "")}/tx/${txHash}`;
}
