export const IDLE_LIMIT_MS = 60 * 60 * 1000;

export function isIdle(lastActivityAt: number, now: number, limit = IDLE_LIMIT_MS): boolean {
  return now - lastActivityAt >= limit;
}
