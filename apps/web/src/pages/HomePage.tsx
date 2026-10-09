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
    <div className="home">
      <div className="card">
        <h1>🍉 FruitVC</h1>
        <p className="muted">Anonymous, instant voice chat for gaming. No accounts.</p>

        <button className="btn btn-primary btn-block" onClick={handleCreateRoom} disabled={isCreating}>
          {isCreating ? "Creating…" : "Create Room"}
        </button>

        <div className="divider">or</div>

        <form className="join-form" onSubmit={handleJoinRoom}>
          <input
            className="input"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Room code"
            maxLength={8}
          />
          <button className="btn btn-secondary" type="submit">Join</button>
        </form>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
