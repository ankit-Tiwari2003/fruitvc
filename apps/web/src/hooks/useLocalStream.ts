import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface UseLocalStreamResult {
  /** One MediaStream object for the lifetime of the page. Its audio track can
   *  be swapped (see commitTrack), so PeerManager never has to be rebuilt. */
  stream: MediaStream | null;
  /** The mic track currently in `stream`. Changes when the mic is switched. */
  track: MediaStreamTrack | null;
  activeDeviceId: string | null;
  error: string | null;
  isLoading: boolean;
  /** Opens a specific input device and returns its track WITHOUT touching the live stream. */
  openInput: (deviceId: string) => Promise<MediaStreamTrack>;
  /** Makes `newTrack` the live track and stops the old one. */
  commitTrack: (newTrack: MediaStreamTrack) => void;
}

/**
 * Requests microphone access once on mount and cleans up on unmount.
 * Audio only — no camera, per the spec.
 */
export function useLocalStream(): UseLocalStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: AUDIO_CONSTRAINTS })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        setTrack(s.getAudioTracks()[0] ?? null);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Could not access microphone");
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const openInput = useCallback(async (deviceId: string) => {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } },
    });
    const [newTrack] = s.getAudioTracks();
    if (!newTrack) throw new Error("Selected device returned no audio track");
    return newTrack;
  }, []);

  const commitTrack = useCallback((newTrack: MediaStreamTrack) => {
    const s = streamRef.current;
    if (!s) return;
    for (const old of s.getAudioTracks()) {
      if (old !== newTrack) {
        s.removeTrack(old);
        old.stop();
      }
    }
    if (!s.getAudioTracks().includes(newTrack)) s.addTrack(newTrack);
    setTrack(newTrack);
  }, []);

  const activeDeviceId = useMemo(() => track?.getSettings().deviceId ?? null, [track]);

  return { stream, track, activeDeviceId, error, isLoading, openInput, commitTrack };
}
