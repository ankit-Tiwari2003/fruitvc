// Shared signaling protocol types.
// These are used by the Durable Object (server) and, later, the browser client.
// Keeping this in one file means both sides can import the exact same types
// once this becomes a real monorepo package.

export interface Participant {
  id: string;
  name: string;
  joinedAt: number;
}

export interface RoomSnapshot {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  participants: Participant[];
}

// Messages sent FROM a client TO the Durable Object over the WebSocket.
export type ClientSignalMessage =
  | {
      type: "join";
      participantId: string;
      name: string;
      token: string;
    }
  | {
      type: "offer";
      from: string;
      to: string;
      sdp: unknown; // RTCSessionDescriptionInit, kept as unknown here (no DOM types on the server)
    }
  | {
      type: "answer";
      from: string;
      to: string;
      sdp: unknown;
    }
  | {
      type: "ice-candidate";
      from: string;
      to: string;
      candidate: unknown; // RTCIceCandidateInit
    };

// Messages sent FROM the Durable Object TO clients.
export type ServerSignalMessage =
  | {
      type: "welcome";
      you: Participant;
      participants: Participant[];
    }
  | {
      type: "participant-joined";
      participantId: string;
      name: string;
    }
  | {
      type: "participant-left";
      participantId: string;
    }
  | {
      type: "offer";
      from: string;
      to: string;
      sdp: unknown;
    }
  | {
      type: "answer";
      from: string;
      to: string;
      sdp: unknown;
    }
  | {
      type: "ice-candidate";
      from: string;
      to: string;
      candidate: unknown;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };

export const ROOM_LIMITS = {
  MAX_PARTICIPANTS: 15,
  MAX_MESSAGE_BYTES: 8 * 1024, // 8 KB — plenty for SDP/ICE, blocks abuse
  INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000, // a room nobody ever joined expires after this
  EMPTY_ROOM_GRACE_MS: 60 * 1000, // an emptied room is deleted after this
} as const;

// Liveness checking. Clients send the text frame "ping" and the Durable Object
// answers "pong" via the runtime's auto-response (no wake-up, no billed request).
// The server uses the last-pong timestamp to evict connections that vanished
// without a close (phone lost signal, laptop slept), which would otherwise
// linger as ghost participants.
export const HEARTBEAT = {
  INTERVAL_MS: 15_000, // how often clients ping (web client keeps its own copy of this)
  // Generous on purpose: browsers throttle timers in background tabs, and the
  // whole point of this app is to sit in a background tab while you game.
  TIMEOUT_MS: 120_000,
  SWEEP_INTERVAL_MS: 20_000, // how often the server checks for silent connections
} as const;

// --- TURN provider fallback chain -------------------------------------------

export type TurnProviderId = "metered" | "xirsys" | "openrelay";

export interface TurnCredentialResponse {
  provider: TurnProviderId | "none"; // "none" means STUN-only, no relay available
  username?: string;
  credential?: string;
  urls?: string[];
  ttl?: number; // seconds
}

// Monthly byte caps per provider, deliberately conservative relative to each
// provider's actual free quota. These are soft caps enforced using
// self-reported client usage (see UsageReport below), not a provider API.
export const TURN_PROVIDER_CAPS_BYTES: Record<TurnProviderId, number> = {
  metered: 450 * 1024 * 1024, // 500 MB quota, cap at 90%
  xirsys: 450 * 1024 * 1024, // 500 MB quota, cap at 90%
  openrelay: 15 * 1024 * 1024 * 1024, // 20 GB shared quota, cap at 75% (conservative — it's a shared public pool)
};

// Client -> server self-report of relay (TURN) byte usage for a single
// peer connection, sent periodically and on disconnect. This is how we
// track usage for providers (like Open Relay) that have no usage API of
// their own, and it's the ground-truth source for providers that do.
export interface UsageReport {
  provider: TurnProviderId;
  roomId: string;
  participantId: string;
  bytesSent: number;
  bytesReceived: number;
  // Rough wall-clock duration this usage covers, for sanity-checking
  // implausible reports (e.g. a single report claiming gigabytes in 10s).
  windowSeconds: number;
}

export type ConnectionQuality = "excellent" | "good" | "poor";

