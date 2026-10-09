import { useCallback, useEffect, useState } from "react";

export interface UseMicControlResult {
  isMuted: boolean;
  toggleMute: () => void;
  pushToTalk: boolean;
  setPushToTalk: (enabled: boolean) => void;
  /** True while the talk key/button is held (push-to-talk mode only). */
  isHolding: boolean;
  setIsHolding: (holding: boolean) => void;
  /** Whether the mic track is actually sending audio right now. */
  isTransmitting: boolean;
}

/**
 * Owns the on/off state of the local mic track.
 *  - Normal mode: transmitting unless muted.
 *  - Push-to-talk mode: transmitting only while Space (or the on-screen
 *    button) is held. The mute button is not used in this mode.
 *
 * Toggling `track.enabled` silences the track without renegotiating any
 * peer connection, so it takes effect instantly for everyone in the room.
 */
export function useMicControl(stream: MediaStream | null): UseMicControlResult {
  const [isMuted, setIsMuted] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [isHolding, setIsHolding] = useState(false);

  const isTransmitting = pushToTalk ? isHolding : !isMuted;

  useEffect(() => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = isTransmitting;
    });
  }, [stream, isTransmitting]);

  useEffect(() => {
    if (!pushToTalk) return;

    // preventDefault on both events stops Space from also "clicking"
    // whichever checkbox/button currently has focus.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat) setIsHolding(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      setIsHolding(false);
    };
    // Switching tabs while holding would otherwise leave the mic stuck on.
    const onBlur = () => setIsHolding(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setIsHolding(false);
    };
  }, [pushToTalk]);

  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  return { isMuted, toggleMute, pushToTalk, setPushToTalk, isHolding, setIsHolding, isTransmitting };
}
