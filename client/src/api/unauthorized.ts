let handler: (() => void) | null = null;

export function setUnauthorizedHandler(next: () => void) {
  handler = next;
}

export function notifyUnauthorized() {
  handler?.();
}
