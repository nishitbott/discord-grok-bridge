const DISCORD_EPOCH_MS = BigInt("1420070400000");
const BIGINT_ZERO = BigInt(0);
const BIGINT_SHIFT = BigInt(22);

export function snowflakeAt(unixMs: number): string {
  const delta = BigInt(unixMs) - DISCORD_EPOCH_MS;
  if (delta <= BIGINT_ZERO) {
    return "0";
  }
  return (delta << BIGINT_SHIFT).toString();
}

export function isNewer(id: string, than: string): boolean {
  try {
    return BigInt(id) > BigInt(than);
  } catch {
    return false;
  }
}

export function newerId(left: string, right: string): string {
  try {
    return BigInt(left) >= BigInt(right) ? left : right;
  } catch {
    return left;
  }
}
