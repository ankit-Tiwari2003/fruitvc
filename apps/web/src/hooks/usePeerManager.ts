import { useCallback, useEffect, useRef, useState } from "react";
import { PeerManager } from "../webrtc/PeerManager";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import type { Participant } from "../../../../packages/shared/src/protocol";
import { getApiBaseUrl, getWsBaseUrl } from "../api/roomsApi";

export interface UsePeerManagerOptions {
  roomId: string;
  participantId: string;
  token: string;
  localStream: MediaStream | null;
  /** The connection to the room died and everything was torn down — rejoin to resync. */
  onSignalingLost?: () => void;
}

export interface UsePeerManagerResult {
  participants: Participant[];
  remoteStreams: Map<string, MediaStream>;
  connectionStats: Map<string, ConnectionStats>;
  error: { code: string; message: string } | null;
  /** Increments each time the room accepts us and sends the member list. */
  connectionEpoch: number;
  /** Swaps the outgoing mic track on every peer connection, no renegotiation. */
  replaceAudioTrack: (track: MediaStreamTrack) => Promise<void>;
}

function without<V>(map: Map<string, V>, key: string): Map<string, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

/**
 * Bridges PeerManager's callback-based API into React state. This is the
 * ONLY place PeerManager gets instantiated — components never touch it
 * directly, they just read the state this hook exposes.
 */
export function usePeerManager(opts: UsePeerManagerOptions): UsePeerManagerResult {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [connectionStats, setConnectionStats] = useState<Map<string, ConnectionStats>>(new Map());
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  const managerRef = useRef<PeerManager | null>(null);
  const lostRef = useRef(opts.onSignalingLost);
  useEffect(() => {
    lostRef.current = opts.onSignalingLost;
  });

  useEffect(() => {
    // Wait for the mic AND real credentials before starting.
    if (!opts.localStream || !opts.roomId || !opts.participantId || !opts.token) return;

    // A new connection starts from a clean slate: anything left over from a
    // previous one (members who have since left, stale stats) must not linger.
    setParticipants([]);
    setRemoteStreams(new Map());
    setConnectionStats(new Map());
    setError(null);

    const manager = new PeerManager({
      apiBaseUrl: getApiBaseUrl(),
      wsBaseUrl: getWsBaseUrl(),
      roomId: opts.roomId,
      participantId: opts.participantId,
      token: opts.token,
      localStream: opts.localStream,
      onRemoteStream: (participantId, stream) => {
        setRemoteStreams((prev) => new Map(prev).set(participantId, stream));
      },
      onParticipantListChanged: (list) => setParticipants(list),
      onConnectionStats: (participantId, stats) => {
        setConnectionStats((prev) => new Map(prev).set(participantId, stats));
      },
      onConnected: () => setConnectionEpoch((n) => n + 1),
      onPeerRemoved: (participantId) => {
        setRemoteStreams((prev) => without(prev, participantId));
        setConnectionStats((prev) => without(prev, participantId));
      },
      onSignalingLost: () => lostRef.current?.(),
      onError: (code, message) => setError({ code, message }),
    });

    managerRef.current = manager;
    void manager.start();

    return () => {
      manager.stop();
      managerRef.current = null;
    };
  }, [opts.localStream, opts.roomId, opts.participantId, opts.token]);

  const replaceAudioTrack = useCallback(async (track: MediaStreamTrack) => {
    await managerRef.current?.replaceAudioTrack(track);
  }, []);

  return { participants, remoteStreams, connectionStats, error, connectionEpoch, replaceAudioTrack };
}
