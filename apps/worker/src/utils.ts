// Room code generation with rejection sampling to avoid modulo bias,
// and small helpers shared across the Worker.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const ALPHABET_LEN = ALPHABET.length; // 32 — nice power-of-two-adjacent size

/**
 * Generates a room code of the given length using crypto-secure randomness.
 * Uses rejection sampling instead of `byte % ALPHABET_LEN` so every character
 * is equally likely (32 divides 256 evenly here, so bias is actually zero,
 * but this pattern is worth having correct as a habit for other alphabets).
 */
export function generateRoomCode(length = 6): string {
  const chars: string[] = [];
  const buf = new Uint8Array(length * 2); // oversample a bit in case of rejections

  while (chars.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (chars.length >= length) break;
      // 256 % 32 === 0 here, so no rejection is actually needed for this
      // alphabet size, but the guard below keeps this correct if ALPHABET
      // ever changes to a length that doesn't divide 256 evenly.
      const limit = 256 - (256 % ALPHABET_LEN);
      if (byte >= limit) continue;
      chars.push(ALPHABET[byte % ALPHABET_LEN]);
    }
  }

  return chars.join("");
}

export function isValidRoomCode(code: string): boolean {
  if (typeof code !== "string") return false;
  if (code.length < 4 || code.length > 10) return false;
  return [...code].every((c) => ALPHABET.includes(c));
}

export function generateParticipantId(): string {
  return crypto.randomUUID();
}

export function generateToken(): string {
  // Opaque, short-lived, random token — enough for MVP WebSocket auth.
  // Not a JWT; just proof you recently completed a legitimate /join call.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const COLORS = ["Blue", "Silver", "Golden", "Crimson", "Violet", "Amber", "Emerald", "Coral"];
const FRUITS = ["Mango", "Kiwi", "Papaya", "Lychee", "Guava", "Fig", "Plum", "Melon"];

export function generateParticipantName(): string {
  const c = COLORS[Math.floor(Math.random() * COLORS.length)];
  const f = FRUITS[Math.floor(Math.random() * FRUITS.length)];
  return `${c} ${f}`;
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
