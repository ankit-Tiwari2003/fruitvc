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
 *   - surfacing connection lifecycle events
 *
 * It knows nothing about WebRTC itself (no RTCPeerConnection here) — that's
 * PeerManager's job. This separation is what let us test the signaling
 * backend (Part 1) completely independently of any WebRTC code at all.
 */

export interface SignalingClientEvents {
  onWelcome?: (you: Participant, existingParticipants: Participant[]) => void;
  onParticipantJoined?: (participantId: string, name: string) => void;
  onParticipantLeft?: (participantId: string) => void;
  onOffer?: (from: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer?: (from: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (from: string, candidate: RTCIceCandidateInit) => void;
  onError?: (code: string, message: string) => void;
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

  constructor(options: SignalingClientOptions) {
    this.opts = options;
  }

  connect(): void {
    const { wsBaseUrl, roomId, participantId, token } = this.opts;
    const url = `${wsBaseUrl}/ws/${roomId}?participantId=${encodeURIComponent(
      participantId
    )}&token=${encodeURIComponent(token)}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (event) => {
      let msg: ServerSignalMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return; // ignore malformed frames rather than crashing the client
      }
      this.dispatch(msg);
    };

    this.ws.onclose = () => {
      if (!this.manuallyClosed) {
        this.opts.events.onClose?.();
      }
    };

    this.ws.onerror = () => {
      // The browser gives no useful detail on WebSocket errors; onclose
      // will fire right after this with whatever info is available.
    };
  }

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
        ev.onError?.(msg.code, msg.message);
        return;
    }
  }

  private send(msg: ClientSignalMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // Signaling messages are only ever sent in direct response to WebRTC
      // negotiation events, which shouldn't happen before the socket is
      // open — if this fires, something upstream called us too early.
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
    this.ws?.close();
    this.ws = null;
  }
}
