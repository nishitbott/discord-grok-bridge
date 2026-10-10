const inflight = new Set<string>();

export function isInflight(messageId: string): boolean {
  return inflight.has(messageId);
}

export function markInflight(messageId: string): void {
  inflight.add(messageId);
}

export function clearInflight(messageId: string): void {
  inflight.delete(messageId);
}
