export function formatRoomCode(code: string): string {
  // Visually split into two groups of 3 for readability, e.g. "K7P 4XQ"
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function formatRtt(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms)}ms`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function formatJitter(ms: number | null): string {
  if (ms === null) return "—";
  return `${ms.toFixed(1)}ms`;
}

/** Converts a byte count over an interval into kbps (bytes*8 / ms = kbit/s). */
export function bytesToKbps(bytes: number, intervalMs: number): number {
  if (intervalMs <= 0) return 0;
  return (bytes * 8) / intervalMs;
}

export function formatKbps(kbps: number): string {
  return `${Math.round(kbps)} kbps`;
}
