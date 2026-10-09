export interface MicButtonProps {
  isMuted: boolean;
  onToggle: () => void;
  pushToTalk: boolean;
  isHolding: boolean;
  onHoldChange: (holding: boolean) => void;
}

export function MicButton({ isMuted, onToggle, pushToTalk, isHolding, onHoldChange }: MicButtonProps) {
  if (pushToTalk) {
    // On-screen hold button so push-to-talk also works on phones (no Space key).
    return (
      <button
        className={`mic-btn ${isHolding ? "mic-btn--on" : "mic-btn--ptt"}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onHoldChange(true);
        }}
        onPointerUp={() => onHoldChange(false)}
        onPointerCancel={() => onHoldChange(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isHolding ? "🎙️ Talking…" : "Hold to talk (or Space)"}
      </button>
    );
  }

  return (
    <button className={`mic-btn ${isMuted ? "mic-btn--off" : "mic-btn--on"}`} onClick={onToggle}>
      {isMuted ? "🔇 Unmute" : "🎙️ Mute"}
    </button>
  );
}
