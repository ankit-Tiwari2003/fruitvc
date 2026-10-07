export interface MicButtonProps {
  isMuted: boolean;
  onToggle: () => void;
}

export function MicButton({ isMuted, onToggle }: MicButtonProps) {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: "0.75rem 1.5rem",
        borderRadius: "999px",
        border: "none",
        backgroundColor: isMuted ? "#ef4444" : "#22c55e",
        color: "white",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {isMuted ? "🔇 Unmute" : "🎙️ Mute"}
    </button>
  );
}
