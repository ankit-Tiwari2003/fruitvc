import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { joinRoom, type JoinRoomResponse } from "../api/roomsApi";
import { useAudioInputs } from "../hooks/useAudioInputs";
import { useLocalStream } from "../hooks/useLocalStream";
import { useMicControl } from "../hooks/useMicControl";
import { usePeerManager } from "../hooks/usePeerManager";
import { RoomView } from "../components/RoomView";
import { copyToClipboard } from "../utils/format";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [identity, setIdentity] = useState<JoinRoomResponse | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [micSwitchError, setMicSwitchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(1);

  const { stream, track, activeDeviceId, error: micError, isLoading: micLoading, openInput, commitTrack } =
    useLocalStream();
  const mic = useMicControl(track);
  const devices = useAudioInputs(stream !== null);

  // Join (HTTP) only once the mic is granted, so the 60s join-token clock
  // doesn't run out while the permission prompt is still showing.
  useEffect(() => {
    if (!roomId || !stream) return;
    let cancelled = false;
    joinRoom(roomId)
      .then((res) => {
        if (!cancelled) setIdentity(res);
      })
      .catch(() => {
        if (!cancelled) setJoinError("Could not join this room. It may not exist or may be full.");
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, stream]);

  const {
    participants,
    remoteStreams,
    connectionStats,
    error: peerError,
    replaceAudioTrack,
  } = usePeerManager({
    roomId: roomId ?? "",
    participantId: identity?.participantId ?? "",
    token: identity?.token ?? "",
    localStream: stream,
  });

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

  if (joinError) {
    return (
      <Centered>
        <p>{joinError}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>
          Back home
        </button>
      </Centered>
    );
  }

  if (micLoading || !identity) {
    return <Centered>Connecting…</Centered>;
  }

  return (
    <RoomView
      roomId={roomId ?? ""}
      localParticipantId={identity.participantId}
      participants={participants}
      remoteStreams={remoteStreams}
      connectionStats={connectionStats}
      peerError={peerError?.message ?? null}
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
