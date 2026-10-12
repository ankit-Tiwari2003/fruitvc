import type {
  ClientSignalMessage,
  ServerSignalMessage,
  Participant,
} from "../../../packages/shared/src/protocol";
import { ROOM_LIMITS, HEARTBEAT } from "../../../packages/shared/src/protocol";
import { generateParticipantId, generateToken, generateUniqueParticipantName } from "./utils";

export interface Env {
  ROOM: DurableObjectNamespace;
  /** Optional overrides (wrangler vars are strings). Defaults come from HEARTBEAT in the shared protocol. */
  HEARTBEAT_TIMEOUT_MS?: string;
  HEARTBEAT_SWEEP_MS?: string;
}

interface RoomMeta {
  createdAt: number;
  lastActivityAt: number;
}

interface PendingJoin {
  token: string;
  name: string;
  expiresAt: number;
}

const PENDING_PREFIX = "pending:";
const PENDING_TTL_MS = 60_000;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/**
 * RoomDurableObject — one instance per room code.
 *
 * Responsibilities (and ONLY these):
 *   - decide who is in the room (join slots, cap, unique names)
 *   - forward signaling messages (offer/answer/ice-candidate) between members
 *   - notice members that vanished and tell everyone else
 *   - delete itself when empty
 *
 * It never sees audio. WebRTC media flows browser-to-browser (or via TURN).
 *
 * Uses the WebSocket Hibernation API, so anything kept only in memory is lost
 * whenever the object is evicted. Therefore everything that must survive
 * (participants, pending join tokens) lives in storage.
 */
export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private participants: Map<string, Participant> = new Map(); // cache of storage
  private timeoutMs: number;
  private sweepMs: number;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.timeoutMs = Number(env.HEARTBEAT_TIMEOUT_MS) || HEARTBEAT.TIMEOUT_MS;
    this.sweepMs = Number(env.HEARTBEAT_SWEEP_MS) || HEARTBEAT.SWEEP_INTERVAL_MS;
    // Answered by the runtime itself, without waking this object.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // --- storage helpers -------------------------------------------------------

  private async loadParticipants(): Promise<void> {
    if (this.participants.size > 0) return;
    const stored = await this.state.storage.get<Record<string, Participant>>("participants");
    if (stored) this.participants = new Map(Object.entries(stored));
  }

  private async saveParticipants(): Promise<void> {
    await this.state.storage.put("participants", Object.fromEntries(this.participants.entries()));
  }

  /** Unexpired pending joins (slots reserved by POST /join but not yet connected). */
  private async loadPending(): Promise<Map<string, PendingJoin>> {
    const all = await this.state.storage.list<PendingJoin>({ prefix: PENDING_PREFIX });
    const now = Date.now();
    const live = new Map<string, PendingJoin>();
    const expired: string[] = [];
    for (const [key, value] of all) {
      if (value.expiresAt < now) expired.push(key);
      else live.set(key.slice(PENDING_PREFIX.length), value);
    }
    if (expired.length) await this.state.storage.delete(expired);
    return live;
  }

  /** Recorded on join/leave only — never per message. */
  private async markActivity(): Promise<void> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta) return;
    meta.lastActivityAt = Date.now();
    await this.state.storage.put("meta", meta);
  }

  /** Ensures a sweep alarm is scheduled soon, without pushing back an earlier one. */
  private async armSweep(): Promise<void> {
    const next = Date.now() + this.sweepMs;
    const current = await this.state.storage.getAlarm();
    if (current === null || current > next) await this.state.storage.setAlarm(next);
  }

  // --- HTTP entry points -----------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/claim" && request.method === "POST") return this.handleClaim();
    if (url.pathname === "/internal/register-join" && request.method === "POST") return this.handleRegisterJoin(request);
    if (url.pathname === "/internal/info" && request.method === "GET") return this.handleInfo();
    if (request.headers.get("Upgrade") === "websocket") return this.handleWebSocketUpgrade(request);

    return new Response("Not found", { status: 404 });
  }

  /**
   * Claims this Durable Object as a brand-new room iff it hasn't been claimed.
   * DOs are created lazily on first access, so "does this room exist" must be
   * answered by our own storage, not by whether the object exists.
   */
  private async handleClaim(): Promise<Response> {
    const existing = await this.state.storage.get<RoomMeta>("meta");
    if (existing) return json({ claimed: false });
    const now = Date.now();
    await this.state.storage.put("meta", { createdAt: now, lastActivityAt: now } satisfies RoomMeta);
    // A room nobody ever joins expires on its own.
    await this.state.storage.setAlarm(now + ROOM_LIMITS.INACTIVITY_TIMEOUT_MS);
    return json({ claimed: true });
  }

  private async handleInfo(): Promise<Response> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta) return json({ exists: false, participantCount: 0, createdAt: null });
    await this.loadParticipants();
    return json({ exists: true, participantCount: this.participants.size, createdAt: meta.createdAt });
  }

  /** Reserves a slot and issues a one-time token. The browser then opens the WebSocket with it. */
  private async handleRegisterJoin(request: Request): Promise<Response> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (!meta) return json({ error: "room_not_found" }, 404);

    await this.loadParticipants();
    const pending = await this.loadPending();

    // Reserved-but-not-yet-connected slots count too, otherwise a burst of
    // simultaneous joins could all pass this check and overfill the room.
    if (this.participants.size + pending.size >= ROOM_LIMITS.MAX_PARTICIPANTS) {
      return json({ error: "room_full" }, 403);
    }

    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const taken = new Set<string>([
      ...[...this.participants.values()].map((p) => p.name),
      ...[...pending.values()].map((p) => p.name),
    ]);
    const requested = body.name?.trim().slice(0, 32);
    const name = requested && !taken.has(requested) ? requested : generateUniqueParticipantName(taken);

    const participantId = generateParticipantId();
    const token = generateToken();
    await this.state.storage.put(PENDING_PREFIX + participantId, {
      token,
      name,
      expiresAt: Date.now() + PENDING_TTL_MS,
    } satisfies PendingJoin);

    return json({ participantId, name, token });
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const participantId = url.searchParams.get("participantId") ?? "";
    const token = url.searchParams.get("token") ?? "";

    const key = PENDING_PREFIX + participantId;
    const pending = participantId ? await this.state.storage.get<PendingJoin>(key) : undefined;
    if (!pending || pending.token !== token || pending.expiresAt < Date.now()) {
      return new Response("Unauthorized", { status: 401 });
    }
    await this.state.storage.delete(key); // single use

    await this.loadParticipants();
    if (this.participants.size >= ROOM_LIMITS.MAX_PARTICIPANTS) {
      return new Response("Room full", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API: identity is stored as tags so it survives eviction.
    this.state.acceptWebSocket(server, [participantId, pending.name]);

    const participant: Participant = { id: participantId, name: pending.name, joinedAt: Date.now() };
    this.participants.set(participantId, participant);
    await this.saveParticipants();
    await this.markActivity();
    await this.armSweep();

    this.sendTo(server, {
      type: "welcome",
      you: participant,
      participants: [...this.participants.values()].filter((p) => p.id !== participantId),
    });
    this.broadcast({ type: "participant-joined", participantId, name: pending.name }, participantId);

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Hibernation API callbacks -------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return; // we only expect text frames

    // Normally answered by the runtime's auto-response and never reaches here.
    if (message === "ping") {
      ws.send("pong");
      return;
    }

    if (message.length > ROOM_LIMITS.MAX_MESSAGE_BYTES) {
      this.sendTo(ws, { type: "error", code: "message_too_large", message: "Message too large" });
      return;
    }

    let parsed: ClientSignalMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.sendTo(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }

    const [senderId] = this.state.getTags(ws);

    // Pure forwarding. No inspection of SDP/ICE contents beyond routing fields.
    switch (parsed.type) {
      case "offer":
      case "answer":
      case "ice-candidate": {
        // Never trust the client's claimed identity for routing.
        if (parsed.from !== senderId) {
          this.sendTo(ws, { type: "error", code: "identity_mismatch", message: "from must match your participant id" });
          return;
        }
        const targetWs = this.findSocketByParticipantId(parsed.to);
        if (!targetWs) {
          this.sendTo(ws, { type: "error", code: "peer_not_found", message: `No such participant: ${parsed.to}` });
          return;
        }
        this.sendTo(targetWs, parsed as ServerSignalMessage);
        return;
      }
      default:
        this.sendTo(ws, { type: "error", code: "unknown_type", message: "Unrecognized message type" });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.handleDisconnect(ws);
    // Complete the closing handshake. Without this the client's socket stays in
    // CLOSING forever and its `close` event never fires, so it can't tell the
    // connection is gone.
    try {
      ws.close(code, reason);
    } catch {
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  /** Idempotent: the sweep and the close event can both report the same member. */
  private async handleDisconnect(ws: WebSocket): Promise<void> {
    await this.loadParticipants();
    const [participantId] = this.state.getTags(ws);
    if (!participantId || !this.participants.has(participantId)) return;

    this.participants.delete(participantId);
    await this.saveParticipants();
    await this.markActivity();
    this.broadcast({ type: "participant-left", participantId });

    if (this.participants.size === 0) {
      await this.state.storage.setAlarm(Date.now() + ROOM_LIMITS.EMPTY_ROOM_GRACE_MS);
    }
  }

  /**
   * Fires in two situations:
   *  - periodically while members are present: evict connections that stopped
   *    answering pings (clients that never ping — older builds — are left alone)
   *  - once a room has been empty (or was never joined) long enough: delete it
   */
  async alarm(): Promise<void> {
    await this.loadParticipants();
    const now = Date.now();

    for (const ws of this.state.getWebSockets()) {
      const lastPong = this.state.getWebSocketAutoResponseTimestamp(ws);
      if (lastPong && now - lastPong.getTime() > this.timeoutMs) {
        await this.handleDisconnect(ws);
        try {
          ws.close(1001, "heartbeat timeout");
        } catch {
          // already closed
        }
      }
    }

    if (this.participants.size > 0) {
      await this.state.storage.setAlarm(now + this.sweepMs);
      return;
    }
    await this.state.storage.deleteAll();
    this.participants.clear();
  }

  // --- helpers ---------------------------------------------------------------

  private findSocketByParticipantId(participantId: string): WebSocket | undefined {
    return this.state.getWebSockets().find((ws) => this.state.getTags(ws)[0] === participantId);
  }

  private sendTo(ws: WebSocket, message: ServerSignalMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // socket likely already closed; ignore
    }
  }

  private broadcast(message: ServerSignalMessage, excludeParticipantId?: string): void {
    for (const ws of this.state.getWebSockets()) {
      const [id] = this.state.getTags(ws);
      if (id === excludeParticipantId) continue;
      this.sendTo(ws, message);
    }
  }
}
