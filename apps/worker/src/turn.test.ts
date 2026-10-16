import { fetchCredentialsForProvider, parseMeteredIceServers } from "./turn";

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`✅ ${msg}`);
}

// The documented response shape: a bare array (STUN + several TURN entries, one shared credential).
const real = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80", username: "u1", credential: "p1" },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "u1", credential: "p1" },
  { urls: "turn:global.relay.metered.ca:443", username: "u1", credential: "p1" },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "u1", credential: "p1" },
];
const a = parseMeteredIceServers(real);
check(a.provider === "metered" && a.username === "u1" && a.credential === "p1", "bare-array response: credential extracted");
check(a.urls?.length === 4, `bare-array response: all 4 TURN urls kept (got ${a.urls?.length})`);
check(!a.urls?.some((u) => u.startsWith("stun:")), "STUN entry is not mixed into the TURN url list");

const b = parseMeteredIceServers({ iceServers: real });
check(b.urls?.length === 4, "wrapped { iceServers } shape is accepted too");

let threw = 0;
for (const bad of [{ error: "Invalid API Key" }, [], [{ urls: "stun:x:80" }], null, "nope"]) {
  try { parseMeteredIceServers(bad); } catch { threw++; }
}
check(threw === 5, "5 malformed/error responses are all rejected (they fall back instead of crashing)");

async function providerTests(): Promise<void> {
  // The whole provider function with the network call mocked: URL built from the secrets, response parsed.
  const realFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: unknown) => {
    requested = String(input);
    return new Response(JSON.stringify(real), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const viaProvider = await fetchCredentialsForProvider("metered", { METERED_APP_NAME: "fruitvc", METERED_API_KEY: "k e/y" });
  check(requested === "https://fruitvc.metered.live/api/v1/turn/credentials?apiKey=k%20e%2Fy", `Metered request URL is built correctly and the key is URL-encoded (${requested})`);
  check(viaProvider.provider === "metered" && viaProvider.urls?.length === 4, "fetchCredentialsForProvider('metered') returns usable TURN credentials from the documented response");

  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Invalid API Key" }), { status: 401 })) as typeof fetch;
  let rejected = false;
  try { await fetchCredentialsForProvider("metered", { METERED_APP_NAME: "fruitvc", METERED_API_KEY: "bad" }); } catch { rejected = true; }
  check(rejected, "an Invalid API Key response (401) makes the provider throw, so the Worker reports a clear reason instead of broken credentials");
  globalThis.fetch = realFetch;
}

providerTests().catch((e) => {
  console.error(e);
  queueMicrotask(() => {
    throw e; // uncaught -> non-zero exit
  });
});
