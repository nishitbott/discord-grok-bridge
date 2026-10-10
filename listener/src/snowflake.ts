const DISCORD_EPOCH_MS = 1_420_070_400_000n;

export function snowflakeAt(unixMs: number): string {
  const delta = BigInt(unixMs) - DISCORD_EPOCH_MS;
  if (delta <= 0n) {
    return "0";
  }
  return (delta << 22n).toString();
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
