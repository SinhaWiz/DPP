/** JSON that survives bigint: bigints become decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function fromJson<T = unknown>(text: string | null | undefined): T | null {
  return text == null ? null : (JSON.parse(text) as T);
}
