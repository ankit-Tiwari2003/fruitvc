import { useMicLevel } from "../hooks/useMicLevel";
import { GOOD_DB, dbToMeter, type LevelStatus } from "../utils/audioLevel";

const STATUS_TEXT: Record<LevelStatus, string> = {
  good: "Level good",
  low: "Low — try another mic",
  silent: "No sound detected — speak, or try another mic",
};

/** Live input meter. The tick marks the level a healthy mic should reach while you speak. */
export function MicMeter({ track }: { track: MediaStreamTrack | null }) {
  const { meter, status } = useMicLevel(track);
  return (
    <div className="mic-meter">
      <div className={`meter meter--${status}`}>
        <div className="meter-fill" style={{ width: `${meter * 100}%` }} />
        <div className="meter-tick" style={{ left: `${dbToMeter(GOOD_DB) * 100}%` }} />
      </div>
      <span className="muted small">{STATUS_TEXT[status]}</span>
    </div>
  );
}
