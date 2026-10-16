import type { TurnCredentialResponse, TurnProviderId } from "../../../packages/shared/src/protocol";

export interface TurnEnv {
  // Metered dedicated account (optional — leave unset if you don't have one)
  METERED_APP_NAME?: string; // e.g. "fruitvc" -> fruitvc.metered.live
  METERED_API_KEY?: string;
  /** Optional: monthly relay cap in MB for the Metered slot. Set this to match your plan's quota. */
  METERED_CAP_MB?: string;

  // Xirsys (optional — leave unset if you don't have one)
  XIRSYS_IDENT?: string;
  XIRSYS_SECRET?: string;
  XIRSYS_CHANNEL?: string;
  XIRSYS_CAP_MB?: string;
}

/** Which providers are usable right now, based on which secrets are configured. */
export function configuredProviders(env: TurnEnv): TurnProviderId[] {
  const providers: TurnProviderId[] = [];
  if (env.METERED_APP_NAME && env.METERED_API_KEY) providers.push("metered");
  if (env.XIRSYS_IDENT && env.XIRSYS_SECRET && env.XIRSYS_CHANNEL) providers.push("xirsys");
  // Open Relay needs no configuration at all — static public credentials.
  providers.push("openrelay");
  return providers;
}

/**
 * Metered's GET /api/v1/turn/credentials returns a BARE ARRAY of ICE servers
 * (one STUN entry plus several TURN entries for different ports/transports,
 * all sharing one username/credential). We also accept { iceServers: [...] }
 * in case that ever changes. Exported so it can be tested without the network.
 */
export function parseMeteredIceServers(data: unknown): TurnCredentialResponse {
  const list = Array.isArray(data) ? data : (data as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list)) throw new Error("Metered response was not an ICE server list");

  type Entry = { urls: string | string[]; username?: string; credential?: string };
  const isTurn = (e: Entry): boolean =>
    !!e && !!e.username && !!e.credential && [e.urls].flat().some((u) => /^turns?:/i.test(u));
  const turnEntries = (list as Entry[]).filter(isTurn);
  if (turnEntries.length === 0) throw new Error("Metered response had no TURN entries");

  return {
    provider: "metered",
    username: turnEntries[0].username!,
    credential: turnEntries[0].credential!,
    urls: [...new Set(turnEntries.flatMap((e) => [e.urls].flat().filter((u) => /^turns?:/i.test(u))))],
    ttl: 3600,
  };
}

async function fetchMeteredCredentials(env: TurnEnv): Promise<TurnCredentialResponse> {
  const url = `https://${env.METERED_APP_NAME}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY ?? "")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Metered credential fetch failed: ${res.status}`);
  return parseMeteredIceServers(await res.json());
}

async function fetchXirsysCredentials(env: TurnEnv): Promise<TurnCredentialResponse> {
  const auth = btoa(`${env.XIRSYS_IDENT}:${env.XIRSYS_SECRET}`);
  const res = await fetch(`https://global.xirsys.net/_turn/${env.XIRSYS_CHANNEL}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ format: "urls" }),
  });
  if (!res.ok) throw new Error(`Xirsys credential fetch failed: ${res.status}`);
  const data = (await res.json()) as {
    v: { iceServers: { urls: string[] | string; username: string; credential: string } };
  };
  const ice = data.v.iceServers;
  return {
    provider: "xirsys",
    username: ice.username,
    credential: ice.credential,
    urls: Array.isArray(ice.urls) ? ice.urls : [ice.urls],
    ttl: 3600,
  };
}

/**
 * Open Relay Project's static, publicly-documented shared credentials.
 * No signup, no API call needed — these are the same for every project
 * using Open Relay. See usage.ts for why this provider's cap is treated
 * more conservatively than the dedicated-account providers.
 */
function openRelayCredentials(): TurnCredentialResponse {
  return {
    provider: "openrelay",
    username: "openrelayproject",
    credential: "openrelayproject",
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    ttl: 3600,
  };
}

export async function fetchCredentialsForProvider(
  provider: TurnProviderId,
  env: TurnEnv
): Promise<TurnCredentialResponse> {
  switch (provider) {
    case "metered":
      return fetchMeteredCredentials(env);
    case "xirsys":
      return fetchXirsysCredentials(env);
    case "openrelay":
      return openRelayCredentials();
  }
}
