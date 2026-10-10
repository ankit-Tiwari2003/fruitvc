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
}

export interface UsePeerManagerResult {
  participants: Participant[];
  remoteStreams: Map<string, MediaStream>;
  connectionStats: Map<string, ConnectionStats>;
  error: { code: string; message: string } | null;
  /** Swaps the outgoing mic track on every peer connection, no renegotiation. */
  replaceAudioTrack: (track: MediaStreamTrack) => Promise<void>;
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

  const managerRef = useRef<PeerManager | null>(null);

  useEffect(() => {
    // Wait for the mic before starting — PeerManager needs a real stream
    // to attach tracks to every peer connection it creates.
    if (!opts.localStream || !opts.roomId || !opts.participantId || !opts.token) return;

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
      onError: (code, message) => setError({ code, message }),
    });

    managerRef.current = manager;
    void manager.start();

    return () => {
      manager.stop();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-run if the stream or identity actually changes
  }, [opts.localStream, opts.roomId, opts.participantId, opts.token]);

  const replaceAudioTrack = useCallback(async (track: MediaStreamTrack) => {
    await managerRef.current?.replaceAudioTrack(track);
  }, []);

  return { participants, remoteStreams, connectionStats, error, replaceAudioTrack };
}
