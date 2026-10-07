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
