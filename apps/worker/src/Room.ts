import type {
  ClientSignalMessage,
  ServerSignalMessage,
  Participant,
} from "../../../packages/shared/src/protocol";
import { ROOM_LIMITS } from "../../../packages/shared/src/protocol";
import { generateParticipantId, generateParticipantName, generateToken } from "./utils";

export interface Env {
  ROOM: DurableObjectNamespace;
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

/**
 * RoomDurableObject — one instance per room code.
 *
 * Responsibilities (and ONLY these):
 *   - track connected participants
 *   - forward signaling messages (offer/answer/ice-candidate) between them
 *   - clean itself up when empty
 *
 * This class never sees audio. WebRTC media flows directly between browsers
 * (or via Cloudflare TURN), completely outside this object's awareness.
 *
 * Uses the WebSocket Hibernation API (state.acceptWebSocket) so idle rooms
 * don't hold the DO in memory / cost wall-clock CPU time while participants
 * are just sitting there connected but not sending signaling traffic.
 */
export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  // Reserved for future use (e.g. TURN credential secrets passed to this DO).
  // Referenced via `void` below purely to satisfy noUnusedLocals until then.
  private env: Env;

  // participantId -> Participant metadata. Rehydrated from storage after hibernation.
  private participants: Map<string, Participant> = new Map();

  // Short-lived tokens issued by POST /join, redeemed once on WebSocket connect.
  private pendingJoins: Map<string, PendingJoin> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    void this.env;
  }

  private async getMeta(): Promise<RoomMeta> {
    const meta = await this.state.storage.get<RoomMeta>("meta");
    if (meta) return meta;
    const fresh: RoomMeta = { createdAt: Date.now(), lastActivityAt: Date.now() };
    await this.state.storage.put("meta", fresh);
    return fresh;
  }

  private async touch(): Promise<void> {
    const meta = await this.getMeta();
    meta.lastActivityAt = Date.now();
    await this.state.storage.put("meta", meta);
    // Re-arm the cleanup alarm every time there's activity.
    await this.state.storage.setAlarm(Date.now() + ROOM_LIMITS.INACTIVITY_TIMEOUT_MS);
  }

  private async loadParticipants(): Promise<void> {
    if (this.participants.size > 0) return;
    const stored = await this.state.storage.get<Record<string, Participant>>("participants");
    if (stored) {
      this.participants = new Map(Object.entries(stored));
    }
  }

  private async saveParticipants(): Promise<void> {
    await this.state.storage.put(
      "participants",
      Object.fromEntries(this.participants.entries())
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal call from the Worker's POST /api/rooms — atomically claims
    // this DO as a brand-new room, or reports that it's already taken.
    // Used purely for room-code collision detection at creation time.
    if (url.pathname === "/internal/claim" && request.method === "POST") {
      return this.handleClaim();
    }

    // Internal call from the Worker's POST /api/rooms/:id/join
    if (url.pathname === "/internal/register-join" && request.method === "POST") {
      return this.handleRegisterJoin(request);
    }

    if (url.pathname === "/internal/info" && request.method === "GET") {
      return this.handleInfo();
    }

    // WebSocket upgrade for actual signaling
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Called by the Worker when a participant successfully POSTs /join.
   * Reserves a slot, generates identity + token, but does NOT open the
   * WebSocket yet — the browser does that next with the returned token.
   */
  private async handleRegisterJoin(request: Request): Promise<Response> {
    await this.loadParticipants();

    if (this.participants.size >= ROOM_LIMITS.MAX_PARTICIPANTS) {
      return new Response(JSON.stringify({ error: "room_full" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const participantId = generateParticipantId();
    const name = body.name?.slice(0, 32) || generateParticipantName();
    const token = generateToken();

    // Token is valid for 60s — just long enough for the browser to open
    // the WebSocket right after receiving the join response.
    this.pendingJoins.set(participantId, {
      token,
      name,
      expiresAt: Date.now() + 60_000,
    });

    await this.touch();

    return new Response(
      JSON.stringify({ participantId, name, token }),
      { headers: { "content-type": "application/json" } }
    );
  }

  /**
   * Claims this Durable Object instance as a new room, iff it hasn't already
   * been claimed. This is how the Worker checks for room-code collisions:
   * DOs are lazily created on first access, so "does this code already
   * exist" has to be answered by checking our own storage, not by whether
   * the DO object itself exists.
   */
  private async handleClaim(): Promise<Response> {
    const existing = await this.state.storage.get<RoomMeta>("meta");
    if (existing) {
      return new Response(JSON.stringify({ claimed: false }), {
        headers: { "content-type": "application/json" },
      });
    }
    await this.getMeta(); // creates and persists meta, claiming this room code
    await this.state.storage.setAlarm(Date.now() + ROOM_LIMITS.INACTIVITY_TIMEOUT_MS);
    return new Response(JSON.stringify({ claimed: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  private async handleInfo(): Promise<Response> {
    await this.loadParticipants();
    const meta = await this.getMeta();
    return new Response(
      JSON.stringify({
        exists: true,
        participantCount: this.participants.size,
        createdAt: meta.createdAt,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const participantId = url.searchParams.get("participantId") ?? "";
    const token = url.searchParams.get("token") ?? "";

    const pending = this.pendingJoins.get(participantId);
    if (!pending || pending.token !== token || pending.expiresAt < Date.now()) {
      return new Response("Unauthorized", { status: 401 });
    }
    this.pendingJoins.delete(participantId);

    await this.loadParticipants();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API: the DO can be evicted from memory between messages
    // and Cloudflare will wake it back up when a message arrives on this
    // socket. We attach participant identity as serialized tags so we can
    // recover "who is this" after a wake-up.
    this.state.acceptWebSocket(server, [participantId, pending.name]);

    const participant: Participant = {
      id: participantId,
      name: pending.name,
      joinedAt: Date.now(),
    };
    this.participants.set(participantId, participant);
    await this.saveParticipants();
    await this.touch();

    // Tell the new participant who's already here.
    this.sendTo(server, {
      type: "welcome",
      you: participant,
      participants: [...this.participants.values()].filter((p) => p.id !== participantId),
    });

    // Tell everyone else the new participant arrived.
    this.broadcast(
      { type: "participant-joined", participantId, name: pending.name },
      participantId
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Hibernation API callbacks -------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return; // we only expect JSON text frames

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

    await this.loadParticipants();
    const [senderId] = this.state.getTags(ws);
    await this.touch();

    // Pure forwarding. No inspection of SDP/ICE contents beyond routing fields.
    switch (parsed.type) {
      case "offer":
      case "answer":
      case "ice-candidate": {
        // Enforce that `from` matches the authenticated socket — never trust
        // the client's claimed identity for routing.
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

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    await this.loadParticipants();
    const [participantId] = this.state.getTags(ws);
    if (!participantId) return;

    this.participants.delete(participantId);
    await this.saveParticipants();
    await this.touch();

    this.broadcast({ type: "participant-left", participantId });

    if (this.participants.size === 0) {
      // No inactivity wait needed once the room is empty — clean up on next alarm tick,
      // but also shrink the alarm so an empty room doesn't linger for the full 30 minutes.
      await this.state.storage.setAlarm(Date.now() + 60_000);
    }
  }

  /** Cleanup: fires when the inactivity timeout elapses with no renewed activity. */
  async alarm(): Promise<void> {
    await this.loadParticipants();
    if (this.participants.size === 0) {
      await this.state.storage.deleteAll();
      this.participants.clear();
      return;
    }
    // Still occupied somehow (e.g. sockets alive without recent messages) —
    // just re-check later rather than evicting active participants.
    await this.state.storage.setAlarm(Date.now() + ROOM_LIMITS.INACTIVITY_TIMEOUT_MS);
  }

  // --- helpers ---------------------------------------------------------------

  private findSocketByParticipantId(participantId: string): WebSocket | undefined {
    return this.state
      .getWebSockets()
      .find((ws) => this.state.getTags(ws)[0] === participantId);
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
