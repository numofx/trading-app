/**
 * Truncates an address to its recognizable ends: `0x1a2b…9f0c`.
 *
 * Long enough that a trader can tell two of their own wallets apart, short enough to sit inline
 * next to other text. Addresses shorter than the two slices are returned unchanged rather than
 * padded into something that looks truncated but is not.
 */
export function formatAddressShort(address: string) {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
