import type {
  ClientSignalMessage,
  ServerSignalMessage,
  Participant,
} from "../../../../packages/shared/src/protocol";

/**
 * SignalingClient — thin typed wrapper around the WebSocket connection to
 * a room's Durable Object. Responsible ONLY for:
 *   - connecting with the join token
 *   - sending/receiving typed signaling messages
 *   - noticing when the connection is gone (closed OR silently dead)
 *
 * It knows nothing about WebRTC (no RTCPeerConnection here) — that's
 * PeerManager's job.
 */

// Local copies on purpose: the web build must not depend at runtime on files
// outside apps/web. Keep in sync with HEARTBEAT in packages/shared.
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;

export interface SignalingClientEvents {
  onWelcome?: (you: Participant, existingParticipants: Participant[]) => void;
  onParticipantJoined?: (participantId: string, name: string) => void;
  onParticipantLeft?: (participantId: string) => void;
  onOffer?: (from: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer?: (from: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (from: string, candidate: RTCIceCandidateInit) => void;
  onError?: (code: string, message: string) => void;
  /** Fires once if the connection ends for any reason other than close(). */
  onClose?: () => void;
}

export interface SignalingClientOptions {
  wsBaseUrl: string; // e.g. "wss://fruitvc-api.yoursubdomain.workers.dev"
  roomId: string;
  participantId: string;
  token: string;
  events: SignalingClientEvents;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private opts: SignalingClientOptions;
  private manuallyClosed = false;
  private notifiedClosed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once the server has answered a ping. Older Workers never do. */
  private heartbeatConfirmed = false;

  constructor(options: SignalingClientOptions) {
    this.opts = options;
  }

  connect(): void {
    const { wsBaseUrl, roomId, participantId, token } = this.opts;
    const url = `${wsBaseUrl}/ws/${roomId}?participantId=${encodeURIComponent(
      participantId
    )}&token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      if (event.data === "pong") {
        this.onPong();
        return;
      }
      let msg: ServerSignalMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return; // ignore malformed frames rather than crashing the client
      }
      this.dispatch(msg);
    };

    ws.onclose = () => this.handleClosed();

    ws.onerror = () => {
      // Browsers give no useful detail on WebSocket errors; onclose follows.
    };
  }

  // --- liveness -------------------------------------------------------------

  /**
   * A phone that loses signal or a laptop that sleeps often never sends a
   * TCP close, so the socket just sits there "open" for minutes. Pinging lets
   * us notice within ~10s and reconnect.
   */
  private ping(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send("ping");
    } catch {
      return;
    }
    if (this.pongTimer) return; // one outstanding ping at a time
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      if (!this.heartbeatConfirmed) {
        // The server never answered a ping: it's an older Worker that doesn't
        // know the heartbeat. Stop pinging instead of dropping a healthy socket.
        this.stopHeartbeat();
        return;
      }
      // It answered before and has now gone quiet: the connection is dead.
      this.handleClosed();
      try {
        this.ws?.close();
      } catch {
        // already closed
      }
    }, PONG_TIMEOUT_MS);
  }

  private onPong(): void {
    this.heartbeatConfirmed = true;
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private handleClosed(): void {
    this.stopHeartbeat();
    if (this.manuallyClosed || this.notifiedClosed) return;
    this.notifiedClosed = true;
    this.opts.events.onClose?.();
  }

  // --- messages -------------------------------------------------------------

  private dispatch(msg: ServerSignalMessage): void {
    const ev = this.opts.events;
    switch (msg.type) {
      case "welcome":
        ev.onWelcome?.(msg.you, msg.participants);
        return;
      case "participant-joined":
        ev.onParticipantJoined?.(msg.participantId, msg.name);
        return;
      case "participant-left":
        ev.onParticipantLeft?.(msg.participantId);
        return;
      case "offer":
        ev.onOffer?.(msg.from, msg.sdp as RTCSessionDescriptionInit);
        return;
      case "answer":
        ev.onAnswer?.(msg.from, msg.sdp as RTCSessionDescriptionInit);
        return;
      case "ice-candidate":
        ev.onIceCandidate?.(msg.from, msg.candidate as RTCIceCandidateInit);
        return;
      case "error":
        // An older Worker answers our "ping" with a bad_json error. Harmless.
        if (msg.code === "bad_json") return;
        ev.onError?.(msg.code, msg.message);
        return;
    }
  }

  private send(msg: ClientSignalMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn("SignalingClient: attempted to send before socket open", msg.type);
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  sendOffer(to: string, sdp: RTCSessionDescriptionInit): void {
    this.send({ type: "offer", from: this.opts.participantId, to, sdp });
  }

  sendAnswer(to: string, sdp: RTCSessionDescriptionInit): void {
    this.send({ type: "answer", from: this.opts.participantId, to, sdp });
  }

  sendIceCandidate(to: string, candidate: RTCIceCandidateInit): void {
    this.send({ type: "ice-candidate", from: this.opts.participantId, to, candidate });
  }

  close(): void {
    this.manuallyClosed = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }
}
