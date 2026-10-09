// Names are generated server-side as "<Color> <Fruit>" (see worker utils.ts).
// The color word drives the participant's tile color.
const COLOR_HEX: Record<string, string> = {
  Blue: "#3b82f6",
  Silver: "#cbd5e1",
  Golden: "#facc15",
  Crimson: "#dc2626",
  Violet: "#8b5cf6",
  Amber: "#f59e0b",
  Emerald: "#10b981",
  Coral: "#fb7185",
};

export function participantColor(name: string): string {
  return COLOR_HEX[name.split(" ")[0]] ?? "#64748b";
}

export function participantInitial(name: string): string {
  const parts = name.split(" ");
  return (parts[1] ?? parts[0] ?? "?").charAt(0).toUpperCase();
}
