import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api/roomsApi";

export function HomePage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateRoom() {
    setIsCreating(true);
    setError(null);
    try {
      const { roomId } = await createRoom();
      navigate(`/room/${roomId}`);
    } catch {
      setError("Could not create a room. Try again.");
    } finally {
      setIsCreating(false);
    }
  }

  function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Enter a valid room code.");
      return;
    }
    navigate(`/room/${code}`);
  }

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "420px",
        margin: "4rem auto",
        padding: "0 1rem",
        textAlign: "center",
      }}
    >
      <h1>🍉 FruitVC</h1>
      <p style={{ color: "#6b7280" }}>Anonymous, instant voice chat for gaming. No accounts.</p>

      <div style={{ marginTop: "2rem" }}>
        <button
          onClick={handleCreateRoom}
          disabled={isCreating}
          style={{
            padding: "0.9rem 2rem",
            borderRadius: "0.75rem",
            border: "none",
            backgroundColor: "#111827",
            color: "white",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: "pointer",
            width: "100%",
          }}
        >
          {isCreating ? "Creating…" : "Create Room"}
        </button>
      </div>

      <div style={{ margin: "1.5rem 0", color: "#9ca3af" }}>— or —</div>

      <form onSubmit={handleJoinRoom} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="Enter room code"
          maxLength={8}
          style={{
            flex: 1,
            padding: "0.75rem 1rem",
            borderRadius: "0.75rem",
            border: "1px solid #d1d5db",
            fontSize: "1rem",
            textTransform: "uppercase",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "0.75rem 1.25rem",
            borderRadius: "0.75rem",
            border: "1px solid #111827",
            backgroundColor: "white",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Join
        </button>
      </form>

      {error && <p style={{ color: "#ef4444", marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}
