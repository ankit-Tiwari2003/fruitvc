import { useEffect } from "react";
import { useWaveform } from "../hooks/useWaveform";

/**
 * The little wave on a participant card. It owns the ~12 updates per second
 * itself, so only these few bars re-render — the parent is told only when
 * "speaking" flips.
 */
export function SpeakingWave({
  source,
  onSpeakingChange,
}: {
  source: MediaStream | MediaStreamTrack | null;
  onSpeakingChange?: (speaking: boolean) => void;
}) {
  const { bars, speaking } = useWaveform(source);

  useEffect(() => {
    onSpeakingChange?.(speaking);
  }, [speaking, onSpeakingChange]);

  return (
    <div className={`wave ${speaking ? "wave--live" : ""}`} aria-hidden="true">
      {bars.map((h, i) => (
        <span key={i} className="wave-bar" style={{ height: `${Math.max(4, Math.round(h * 100))}%` }} />
      ))}
    </div>
  );
}
