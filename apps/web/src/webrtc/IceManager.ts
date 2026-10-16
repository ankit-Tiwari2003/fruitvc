import type { TurnCredentialResponse, TurnProviderId } from "../../../../packages/shared/src/protocol";

/**
 * IceManager — fetches TURN credentials from the Worker's fallback chain
 * (see apps/worker/src/turn.ts) and builds the iceServers list WebRTC needs.
 *
 * Deliberately simple: one fetch, one result, consumed once per call setup.
 * TURN credentials are short-lived (ttl from the response, typically 1hr),
 * which is plenty for a single voice session.
 */

const CLOUDFLARE_STUN_URL = "stun:stun.cloudflare.com:3478";

/** What we know about the TURN relay (the fallback path when a direct connection is impossible). */
export type RelayStatus = "unconfigured" | "unknown" | "working" | "unavailable";

/**
 * Test switch: open the room URL with ?relay=1 to force every connection
 * through the relay. Direct connections are the norm, so without this you'd
 * never find out whether the relay actually works until someone can't connect.
 */
export function isRelayTestMode(): boolean {
  return typeof location !== "undefined" && new URLSearchParams(location.search).get("relay") === "1";
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  /** "relay" = relay-only test mode (see isRelayTestMode). */
  iceTransportPolicy: RTCIceTransportPolicy;
  /** Why the Worker offered no relay, when it didn't (diagnostics only). */
  relayNote?: string;
  /** Which provider issued the TURN credentials, if any — needed by
   *  ConnectionMonitor to tag usage reports correctly. null means
   *  STUN-only (no relay available right now). */
  relayProvider: TurnProviderId | null;
}

export async function fetchIceConfig(apiBaseUrl: string): Promise<IceConfig> {
  const iceServers: RTCIceServer[] = [{ urls: CLOUDFLARE_STUN_URL }];
  const iceTransportPolicy: RTCIceTransportPolicy = isRelayTestMode() ? "relay" : "all";

  let creds: TurnCredentialResponse;
  try {
    const res = await fetch(`${apiBaseUrl}/api/turn-credentials`);
    if (!res.ok) throw new Error(`turn-credentials fetch failed: ${res.status}`);
    creds = await res.json();
  } catch (err) {
    // STUN-only is a legitimate degraded state, not a fatal error — most
    // direct P2P connections don't need TURN at all. Log and continue.
    console.warn("Could not fetch TURN credentials, continuing STUN-only:", err);
    return { iceServers, iceTransportPolicy, relayProvider: null, relayNote: "could_not_fetch_turn_credentials" };
  }

  if (creds.provider === "none" || !creds.urls || !creds.username || !creds.credential) {
    return { iceServers, iceTransportPolicy, relayProvider: null, relayNote: creds.reason ?? "no_relay_offered" };
  }

  iceServers.push({
    urls: creds.urls,
    username: creds.username,
    credential: creds.credential,
  });

  return { iceServers, iceTransportPolicy, relayProvider: creds.provider };
}
