import { MicButton } from "./MicButton";
import type { UseMicControlResult } from "../hooks/useMicControl";

export function ControlBar({ mic, onLeave }: { mic: UseMicControlResult; onLeave: () => void }) {
  const hint = mic.pushToTalk
    ? "Push-to-talk is on — hold Space or the button"
    : mic.isMuted
      ? "You're muted"
      : "Your mic is live";

  return (
    <footer className="bar">
      <div className="bar-left">
        <strong>Call controls</strong>
        <span className="muted small">{hint}</span>
      </div>
      <div className="bar-right">
        <MicButton
          isMuted={mic.isMuted}
          onToggle={mic.toggleMute}
          pushToTalk={mic.pushToTalk}
          isHolding={mic.isHolding}
          onHoldChange={mic.setIsHolding}
        />
        <button className="leave-btn" onClick={onLeave}>
          Leave
        </button>
      </div>
    </footer>
  );
}
