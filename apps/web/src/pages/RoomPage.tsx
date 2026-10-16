import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, joinRoom, type JoinRoomResponse } from "../api/roomsApi";
import { useAudioInputs } from "../hooks/useAudioInputs";
import { useLocalStream } from "../hooks/useLocalStream";
import { useMicControl } from "../hooks/useMicControl";
import { usePeerManager } from "../hooks/usePeerManager";
import { RoomView } from "../components/RoomView";
import { copyToClipboard } from "../utils/format";

const MAX_RECONNECT_ATTEMPTS = 8;
const retryDelayMs = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 8000);

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [identity, setIdentity] = useState<JoinRoomResponse | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [joinTick, setJoinTick] = useState(0); // bump to (re)run the join step
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [micSwitchError, setMicSwitchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(1);

  const { stream, track, activeDeviceId, error: micError, isLoading: micLoading, openInput, commitTrack } =
    useLocalStream();
  const mic = useMicControl(track);
  const devices = useAudioInputs(stream !== null);

  /** Try to get (back) into the room after a delay that grows with repeated failures. */
  const scheduleRejoin = useCallback(() => {
    failures.current += 1;
    if (failures.current > MAX_RECONNECT_ATTEMPTS) {
      setFatalError("Lost the connection to the room and couldn't get back in. Check your network and rejoin.");
      return;
    }
    setReconnecting(true);
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => setJoinTick((t) => t + 1), retryDelayMs(failures.current));
  }, []);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // Join (HTTP) only once the mic is granted, so the 60s join-token clock
  // doesn't run out while the permission prompt is still showing. Re-runs
  // (with a fresh identity) whenever joinTick changes, i.e. after a lost connection.
  useEffect(() => {
    if (!roomId || !stream) return;
    let cancelled = false;
    joinRoom(roomId)
      .then((res) => {
        if (!cancelled) setIdentity(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setFatalError("This room doesn't exist or has ended.");
        else if (err instanceof ApiError && err.status === 403) setFatalError("This room is full.");
        else scheduleRejoin(); // network trouble: keep trying
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, stream, joinTick, scheduleRejoin]);

  /** The room connection died (closed or silently dead): drop our identity and rejoin from scratch. */
  const handleSignalingLost = useCallback(() => {
    setIdentity(null);
    scheduleRejoin();
  }, [scheduleRejoin]);

  const {
    participants,
    remoteStreams,
    connectionStats,
    error: peerError,
    relay,
    connectionEpoch,
    replaceAudioTrack,
  } = usePeerManager({
    roomId: roomId ?? "",
    participantId: identity?.participantId ?? "",
    token: identity?.token ?? "",
    localStream: stream,
    onSignalingLost: handleSignalingLost,
  });

  // The room accepting us proves the connection works: reset the backoff.
  useEffect(() => {
    if (connectionEpoch > 0) {
      failures.current = 0;
      setReconnecting(false);
    }
  }, [connectionEpoch]);

  /** Manual mic switch: open the new device, hand it to every peer, then retire the old track. */
  async function handleSelectMic(deviceId: string) {
    if (deviceId === activeDeviceId) return;
    setMicSwitchError(null);
    let newTrack: MediaStreamTrack | null = null;
    try {
      newTrack = await openInput(deviceId);
      newTrack.enabled = mic.isTransmitting; // switching while muted must not leak audio
      await replaceAudioTrack(newTrack);
      commitTrack(newTrack);
    } catch {
      newTrack?.stop();
      setMicSwitchError("Couldn't switch to that microphone. It may be in use or unavailable.");
    }
  }

  async function handleCopyInvite() {
    if (!roomId) return;
    const ok = await copyToClipboard(`${window.location.origin}/room/${roomId}`);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (micError) {
    return (
      <Centered>
        <p>🎙️ Couldn't access your microphone.</p>
        <p className="muted small">{micError}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>
          Back home
        </button>
      </Centered>
    );
  }

  if (fatalError) {
    return (
      <Centered>
        <p>{fatalError}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>
          Back home
        </button>
      </Centered>
    );
  }

  if (micLoading || !identity) {
    return reconnecting ? (
      <Centered>
        <p>Connection lost — reconnecting…</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>
          Leave
        </button>
      </Centered>
    ) : (
      <Centered>Connecting…</Centered>
    );
  }

  return (
    <RoomView
      roomId={roomId ?? ""}
      localParticipantId={identity.participantId}
      participants={participants}
      remoteStreams={remoteStreams}
      connectionStats={connectionStats}
      peerError={peerError?.message ?? null}
      relay={relay}
      copied={copied}
      onCopyInvite={handleCopyInvite}
      onLeave={() => navigate("/")}
      mic={mic}
      micInput={{ devices, activeDeviceId, track, error: micSwitchError, onSelect: handleSelectMic }}
      volume={volume}
      onVolumeChange={setVolume}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}
