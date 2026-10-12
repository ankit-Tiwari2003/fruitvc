import { RoomDurableObject } from "./Room";
import { generateRoomCode, isValidRoomCode, jsonResponse } from "./utils";
import { configuredProviders, fetchCredentialsForProvider, type TurnEnv } from "./turn";
import { selectAvailableProvider, recordProviderUsage } from "./usage";
import type { UsageReport } from "../../../packages/shared/src/protocol";

export { RoomDurableObject };

export interface Env extends TurnEnv {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGIN: string; // set via wrangler.jsonc vars, e.g. "https://fruitvc.pages.dev"
  RATE_LIMIT: KVNamespace; // simple token-bucket-ish counters for abuse prevention, also used for TURN usage tracking
  JOIN_RATE_LIMIT?: string; // optional override of the per-IP create/join limit (used by tests)
}

const MAX_ROOM_CREATE_ATTEMPTS = 5; // collision retries before giving up
const JOIN_RATE_LIMIT_PER_MINUTE = 20; // per IP, matches spec section 38

function joinRateLimit(env: Env): number {
  return Number(env.JOIN_RATE_LIMIT) || JOIN_RATE_LIMIT_PER_MINUTE;
}

function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function checkOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  // Allow no-Origin requests (e.g. curl, same-origin navigations without CORS)
  // through for now — this is a dev-friendly default. Tighten before shipping
  // publicly if you want to hard-block missing Origin headers too.
  if (!origin) return true;
  return origin === env.ALLOWED_ORIGIN;
}

/**
 * Extremely simple fixed-window rate limiter backed by KV.
 * Good enough for a portfolio project; swap for Durable Object-based
 * sliding window or Cloudflare Rate Limiting rules if this becomes real.
 */
async function isRateLimited(env: Env, key: string, limit: number): Promise<boolean> {
  const windowKey = `${key}:${Math.floor(Date.now() / 60_000)}`;
  const current = Number((await env.RATE_LIMIT.get(windowKey)) ?? "0");
  if (current >= limit) return true;
  await env.RATE_LIMIT.put(windowKey, String(current + 1), { expirationTtl: 120 });
  return false;
}

function cors(env: Env, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(env, new Response(null, { status: 204 }));
    }

    if (!checkOrigin(request, env)) {
      return jsonResponse({ error: "forbidden_origin" }, { status: 403 });
    }

    // POST /api/rooms — create a new room, retrying on code collision.
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const ip = getClientIp(request);
      if (await isRateLimited(env, `create:${ip}`, joinRateLimit(env))) {
        return cors(env, jsonResponse({ error: "rate_limited" }, { status: 429 }));
      }

      for (let attempt = 0; attempt < MAX_ROOM_CREATE_ATTEMPTS; attempt++) {
        const code = generateRoomCode(6);
        const id = env.ROOM.idFromName(code);
        const stub = env.ROOM.get(id);
        const claimRes = await stub.fetch("https://internal/internal/claim", { method: "POST" });
        const { claimed } = (await claimRes.json()) as { claimed: boolean };
        if (claimed) {
          return cors(env, jsonResponse({ roomId: code }));
        }
        // collision — loop and try another code
      }
      return cors(env, jsonResponse({ error: "could_not_allocate_room" }, { status: 503 }));
    }

    // GET /api/rooms/:roomId — check existence + participant count
    const infoMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
    if (infoMatch && request.method === "GET") {
      const roomId = infoMatch[1];
      if (!isValidRoomCode(roomId)) {
        return cors(env, jsonResponse({ error: "invalid_room_code" }, { status: 400 }));
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
      const res = await stub.fetch("https://internal/internal/info");
      const data = await res.json();
      return cors(env, jsonResponse(data));
    }

    // POST /api/rooms/:roomId/join — reserve a participant slot, get a token
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/join$/);
    if (joinMatch && request.method === "POST") {
      const roomId = joinMatch[1];
      if (!isValidRoomCode(roomId)) {
        return cors(env, jsonResponse({ error: "invalid_room_code" }, { status: 400 }));
      }
      const ip = getClientIp(request);
      if (await isRateLimited(env, `join:${ip}`, joinRateLimit(env))) {
        return cors(env, jsonResponse({ error: "rate_limited" }, { status: 429 }));
      }

      const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
      const res = await stub.fetch("https://internal/internal/register-join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await request.text(),
      });
      const data = await res.json();
      return cors(env, jsonResponse(data, { status: res.status }));
    }

    // WS /ws/:roomId?participantId=...&token=... — actual signaling connection
    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]+)$/);
    if (wsMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return jsonResponse({ error: "expected_websocket" }, { status: 426 });
      }
      const roomId = wsMatch[1];
      if (!isValidRoomCode(roomId)) {
        return jsonResponse({ error: "invalid_room_code" }, { status: 400 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
      // Forward the upgrade request as-is; the DO reads participantId/token
      // from the query string itself.
      return stub.fetch(request);
    }

    // GET /api/turn-credentials — picks the first TURN provider that's
    // both configured and under its monthly usage cap, in priority order
    // (metered -> xirsys -> openrelay). Falls back to STUN-only if every
    // provider is capped out, rather than erroring — a degraded call
    // (direct P2P only) is better than no call.
    if (url.pathname === "/api/turn-credentials" && request.method === "GET") {
      const providers = configuredProviders(env);
      const chosen = await selectAvailableProvider(env.RATE_LIMIT, providers);

      if (!chosen) {
        return cors(env, jsonResponse({ provider: "none" }));
      }

      try {
        const creds = await fetchCredentialsForProvider(chosen, env);
        return cors(env, jsonResponse(creds));
      } catch (err) {
        // Provider is configured but the live request failed (outage, bad
        // key, etc). Don't fail the whole call — just report no relay.
        console.error(`TURN credential fetch failed for ${chosen}:`, err);
        return cors(env, jsonResponse({ provider: "none" }));
      }
    }

    // POST /api/usage-report — client self-reports TURN relay bytes used
    // for a peer connection (see UsageReport in the shared protocol).
    // This is how per-provider monthly caps are enforced, since not every
    // provider (notably Open Relay's shared static credentials) has an
    // account-level usage API we could poll instead.
    if (url.pathname === "/api/usage-report" && request.method === "POST") {
      const ip = getClientIp(request);
      // Usage reports happen periodically during calls, so allow a higher
      // rate than the join/create limits — this isn't a user-facing action.
      if (await isRateLimited(env, `usage:${ip}`, 120)) {
        return cors(env, jsonResponse({ error: "rate_limited" }, { status: 429 }));
      }

      const body = (await request.json().catch(() => null)) as UsageReport | null;
      if (
        !body ||
        typeof body.bytesSent !== "number" ||
        typeof body.bytesReceived !== "number" ||
        typeof body.windowSeconds !== "number" ||
        !["metered", "xirsys", "openrelay"].includes(body.provider)
      ) {
        return cors(env, jsonResponse({ error: "invalid_report" }, { status: 400 }));
      }

      // Sanity-check: reject implausible reports rather than trusting them
      // blindly. At a generous 10 Mbps ceiling, a window can't plausibly
      // account for more than (10 Mbps * windowSeconds) bytes.
      const plausibleMaxBytes = (10_000_000 / 8) * Math.max(body.windowSeconds, 1);
      const totalBytes = body.bytesSent + body.bytesReceived;
      if (totalBytes < 0 || totalBytes > plausibleMaxBytes) {
        return cors(env, jsonResponse({ error: "implausible_report" }, { status: 400 }));
      }

      await recordProviderUsage(env.RATE_LIMIT, body.provider, totalBytes);
      return cors(env, jsonResponse({ ok: true }));
    }

    return cors(env, jsonResponse({ error: "not_found" }, { status: 404 }));
  },
};
