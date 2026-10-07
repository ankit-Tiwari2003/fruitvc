# FruitVC — Signaling Core (Part 1)

This is piece **#1** of the build plan: the Worker + Durable Object signaling
backend. It handles room creation, joining, and WebSocket message forwarding.
It never touches audio — that's the whole point.

## What's here

```
apps/worker/src/
  index.ts   — HTTP routing, CORS, origin check, rate limiting, room create/join
  Room.ts    — RoomDurableObject: one instance per room, WebSocket signaling
  utils.ts   — room code generation, tokens, participant name generation
packages/shared/src/
  protocol.ts — shared message types (client ↔ server signaling protocol)
```

## Run it locally

```bash
cd apps/worker
npm install
npx wrangler dev --local --port 8787
```

This has already been verified working end-to-end (join, welcome message,
participant-joined broadcast, offer/answer/ICE forwarding, identity-spoofing
rejection, and disconnect cleanup all tested against a live local instance).

## Try it yourself

```bash
# create a room
curl -X POST http://localhost:8787/api/rooms -H "Origin: http://localhost:5173"
# → {"roomId":"K7P4XQ"}

# check it exists
curl http://localhost:8787/api/rooms/K7P4XQ -H "Origin: http://localhost:5173"

# join it
curl -X POST http://localhost:8787/api/rooms/K7P4XQ/join \
  -H "Origin: http://localhost:5173" -H "Content-Type: application/json" \
  -d '{"name":"Blue Mango"}'
# → {"participantId":"...","name":"Blue Mango","token":"..."}
```

Then open a WebSocket to `ws://localhost:8787/ws/K7P4XQ?participantId=...&token=...`
with `Origin: http://localhost:5173` set, and you'll get a `welcome` message
back immediately.

## Before deploying for real

1. Update `ALLOWED_ORIGIN` in `wrangler.jsonc` to your actual Pages URL.
2. Create a real KV namespace: `npx wrangler kv namespace create RATE_LIMIT`
   and paste the resulting id into `wrangler.jsonc`.
3. `npx wrangler deploy`

## Part 2 — TURN credentials + connection/usage monitoring

Added on top of the signaling core:

```
apps/worker/src/
  turn.ts    — per-provider TURN credential fetchers (Metered, Xirsys, Open Relay)
  usage.ts   — KV-backed monthly usage caps, per provider
apps/web/src/webrtc/
  ConnectionMonitor.ts      — client-side getStats() poller: quality + relay usage tracking
  ConnectionMonitor.test.ts — standalone test (mocks getStats(), no browser needed)
```

**How the TURN fallback chain works:** `/api/turn-credentials` tries providers
in priority order — Metered (dedicated) → Xirsys → Open Relay (shared, no
signup needed) — skipping any provider that's over its monthly cap, falling
back to `{"provider":"none"}` (STUN-only) if everything's capped. Metered and
Xirsys are both optional; **the app works fully with neither configured**,
since Open Relay's static public credentials need no setup at all.

**How usage caps are enforced:** since not every provider exposes a usable
account-level usage API (Open Relay's shared credentials have no account at
all), usage is tracked from the **client's own `getStats()` data** — the only
place that actually sees the media path. `ConnectionMonitor` detects when a
peer connection is using a relayed (TURN) candidate vs. a direct one, and
only counts bytes toward usage when relayed. It periodically POSTs deltas to
`/api/usage-report`, which the Worker validates (rejects implausible
byte/time combinations) and adds to a per-provider monthly KV counter.

To add a dedicated provider later:
```bash
npx wrangler secret put METERED_APP_NAME
npx wrangler secret put METERED_API_KEY
# and/or
npx wrangler secret put XIRSYS_IDENT
npx wrangler secret put XIRSYS_SECRET
npx wrangler secret put XIRSYS_CHANNEL
```
No code changes needed — `configuredProviders()` in `turn.ts` automatically
detects which secrets are set.

To run the ConnectionMonitor test (mocks `getStats()`, no browser required):
```bash
cd apps/web
npm install
npx tsx src/webrtc/ConnectionMonitor.test.ts
```

## Part 3 — WebRTC peer connection layer

```
apps/web/src/webrtc/
  SignalingClient.ts    — typed WebSocket wrapper around the signaling protocol
  IceManager.ts         — fetches TURN credentials, builds RTCConfiguration
  PeerManager.ts         — orchestrates the mesh: creates/tears down peer
                           connections per signaling events, attaches local
                           audio, wires a ConnectionMonitor into every peer
  PeerManager.test.ts    — orchestration test against the REAL deployed backend
```

**Initiation rule:** when a new participant joins, every participant already
in the room initiates the offer to them (not the other way around). This
avoids "glare" — both sides trying to call `createOffer()` simultaneously —
since only one side of any given pair ever initiates.

**Testing note:** `PeerManager.test.ts` runs in Node (via `tsx`), not a
browser, so it substitutes a `FakeRTCPeerConnection` for the real browser API
— Node has no WebRTC media stack. What it *does* genuinely exercise is
real HTTP/WebSocket traffic against the actual signaling backend (local dev
or deployed), proving the offer/answer/ICE *routing* and connection-state
orchestration logic is correct: who initiates, how messages get addressed
and delivered, how remote-stream and participant-list callbacks fire. The
real SDP/ICE negotiation itself can only be exercised by an actual browser,
which is the next piece (the frontend).

To run it against local dev:
```bash
# terminal 1
cd apps/worker && npx wrangler dev --local --port 8787

# terminal 2
cd apps/web && npm install
npx tsx src/webrtc/PeerManager.test.ts
```

To run it against your deployed Worker instead:
```bash
FRUITVC_API_BASE=https://fruitvc-api.yoursubdomain.workers.dev npx tsx src/webrtc/PeerManager.test.ts
```

## Part 4 — Frontend (React + Vite + React Router)

```
apps/web/
  index.html, vite.config.ts, .env.example
  src/
    main.tsx, App.tsx          — entry point + routing (React Router v7)
    api/roomsApi.ts            — typed wrappers around every Worker endpoint
    hooks/
      useLocalStream.ts        — mic access (getUserMedia), audio-only
      usePeerManager.ts        — bridges PeerManager's callbacks into React state
    components/
      ParticipantGrid.tsx      — lays out all participant tiles
      ParticipantTile.tsx      — one participant: name, audio element, quality badge
      ConnectionBadge.tsx      — excellent/good/poor indicator
      MicButton.tsx            — mute/unmute toggle
    pages/
      HomePage.tsx             — create room / join by code
      RoomPage.tsx             — the actual call screen
    utils/format.ts            — room code formatting, clipboard helper
```

**Setup before running:**
```bash
cd apps/web
npm install
cp .env.example .env.local
# edit .env.local to point at your deployed Worker, or leave as-is for local dev
npm run dev
```
This has been verified: typechecks clean, dev server boots and serves every
route, and `npm run build` produces a working production bundle (53 modules,
no errors).

**Routing:** `/` → HomePage, `/room/:roomId` → RoomPage. Uses `react-router-dom`
v7 (the maintained package — it re-exports the newer `react-router` core
under the hood, so this is the current, non-deprecated way to pull it in).

**Data flow:** `RoomPage` calls `joinRoom()` (the API connector) once on
mount to get a participant identity + token, then hands that straight to
`usePeerManager`, which owns a `PeerManager` instance for the lifetime of
the page and exposes its callbacks as plain React state. Components never
touch `PeerManager` or raw `fetch` directly — they just read hook output.

**What's NOT wired in yet:** pitch-shift and hold-to-whisper (the two
add-on ideas from earlier) aren't built — they'd slot into the local
stream pipeline between `useLocalStream` and `PeerManager`, as additional
`AudioWorklet` processing on the track before it's attached to each peer
connection.

## Design notes worth knowing

- **Room existence** is tracked by whether the DO's own storage has a `meta`
  key set — DOs are lazily instantiated, so "does this room exist" can't be
  answered by whether the DO object exists, only by what's in its storage.
  This is what the `/internal/claim` endpoint is for (collision-safe room
  creation).
- **Identity is never trusted from the client.** The `from` field on every
  signaling message is checked against the authenticated WebSocket's tag —
  a participant literally cannot forge messages as someone else.
- **WebSocket Hibernation API** (`state.acceptWebSocket`) is used instead of
  a plain event listener loop, so idle connected rooms don't burn Durable
  Object wall-clock time waiting for messages that aren't coming.
- **Tokens are short-lived and single-use.** The HTTP join step issues a
  60-second token that's consumed exactly once when the WebSocket connects —
  this stops someone from reusing a stolen join response indefinitely.
