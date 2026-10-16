import type { TurnProviderId } from "../../../packages/shared/src/protocol";
import { TURN_PROVIDER_CAPS_BYTES } from "../../../packages/shared/src/protocol";

/**
 * Usage tracking is intentionally client-reported (see UsageReport in the
 * shared protocol) rather than pulled from each provider's own billing API.
 * This gives us one consistent mechanism that works identically whether a
 * provider happens to expose a usage endpoint or not (Open Relay's shared,
 * unauthenticated credentials have no associated account to query at all).
 *
 * Trade-off, stated plainly: a malicious client could under-report its own
 * usage. For a friends-only project this is an acceptable risk — the goal
 * here is cost control, not a security boundary.
 */

function monthKey(provider: TurnProviderId): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `turn-usage:${provider}:${ym}`;
}

export async function getProviderUsageBytes(
  kv: KVNamespace,
  provider: TurnProviderId
): Promise<number> {
  const raw = await kv.get(monthKey(provider));
  return raw ? Number(raw) : 0;
}

export interface CapOverrides {
  METERED_CAP_MB?: string;
  XIRSYS_CAP_MB?: string;
}

/** The monthly cap for a provider; METERED_CAP_MB / XIRSYS_CAP_MB override the built-in default. */
export function providerCapBytes(provider: TurnProviderId, overrides: CapOverrides = {}): number {
  const mb = provider === "metered" ? Number(overrides.METERED_CAP_MB) : provider === "xirsys" ? Number(overrides.XIRSYS_CAP_MB) : 0;
  return mb > 0 ? mb * 1024 * 1024 : TURN_PROVIDER_CAPS_BYTES[provider];
}

export async function isProviderOverCap(
  kv: KVNamespace,
  provider: TurnProviderId,
  overrides: CapOverrides = {}
): Promise<boolean> {
  const used = await getProviderUsageBytes(kv, provider);
  return used >= providerCapBytes(provider, overrides);
}

/**
 * Adds reported bytes to a provider's running monthly total.
 * Expires the key after 35 days so stale months don't accumulate forever —
 * a fresh key is created automatically as soon as the month rolls over,
 * since monthKey() changes.
 */
export async function recordProviderUsage(
  kv: KVNamespace,
  provider: TurnProviderId,
  bytes: number
): Promise<void> {
  if (bytes <= 0) return;
  const key = monthKey(provider);
  const current = await getProviderUsageBytes(kv, provider);
  await kv.put(key, String(current + bytes), { expirationTtl: 35 * 24 * 60 * 60 });
}

/**
 * Picks the first provider (in priority order) that is both configured
 * (has credentials available in env) and under its monthly cap.
 * Returns null if nothing is available — caller should fall back to
 * STUN-only in that case.
 */
export async function selectAvailableProvider(
  kv: KVNamespace,
  configuredProviders: TurnProviderId[],
  overrides: CapOverrides = {}
): Promise<TurnProviderId | null> {
  // Priority order: dedicated accounts first (more reliable, not shared),
  // shared Open Relay pool last (always "configured" since it needs no setup).
  const priority: TurnProviderId[] = ["metered", "xirsys", "openrelay"];

  for (const provider of priority) {
    if (!configuredProviders.includes(provider)) continue;
    const overCap = await isProviderOverCap(kv, provider, overrides);
    if (!overCap) return provider;
  }
  return null;
}
