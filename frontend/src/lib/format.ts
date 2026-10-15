/** Display formatting. Everything here is pure, so it is easy to test and reuse. */

/** `0x1234ab…cdef`: first 6 and last 4 hex characters of a hash (design tokens). */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= 2 + head + tail + 1) return hash;
  return `${hash.slice(0, 2 + head)}…${hash.slice(-tail)}`;
}

/** `0x7099…79C8` */
export function shortAddress(address: string): string {
  return shortHash(address, 4, 4);
}

const WEI_PER_ETH = 10n ** 18n;

/**
 * Wei as ETH with up to `maxDecimals` places and no trailing zeros. A non-zero amount too small for
 * that precision shows as `< 0.000001` instead of a misleading `0`.
 */
export function formatEth(wei: bigint | string, maxDecimals = 6): string {
  const value = typeof wei === "bigint" ? wei : BigInt(wei);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const whole = abs / WEI_PER_ETH;
  const frac = abs % WEI_PER_ETH;
  if (frac === 0n) return `${negative ? "-" : ""}${group(whole)}`;

  const digits = frac.toString().padStart(18, "0");
  const kept = digits.slice(0, maxDecimals).replace(/0+$/, "");
  if (kept === "" && whole === 0n) return `${negative ? "-" : ""}< 0.${"0".repeat(maxDecimals - 1)}1`;
  return `${negative ? "-" : ""}${group(whole)}${kept ? "." + kept : ""}`;
}

/** Thousands separators for a bigint: 1234567 → 1,234,567 */
export function group(n: bigint | string): string {
  return BigInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A 32-byte slot value as 8 groups of 8 hex characters, for reading raw storage. */
export function groupedWord(word: string): string[] {
  const hex = word.replace(/^0x/, "").padStart(64, "0");
  return hex.match(/.{8}/g) ?? [];
}

/** `12:03:45` in the viewer's locale, from milliseconds or seconds-since-epoch. */
export function formatTime(value: number | bigint | string, unit: "ms" | "s" = "s"): string {
  const ms = unit === "s" ? Number(value) * 1000 : Number(value);
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false });
}

export function formatDateTime(value: number | bigint | string, unit: "ms" | "s" = "s"): string {
  const ms = unit === "s" ? Number(value) * 1000 : Number(value);
  return new Date(ms).toLocaleString(undefined, { hour12: false });
}
