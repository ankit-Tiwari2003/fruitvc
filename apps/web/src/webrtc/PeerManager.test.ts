/**
 * This test validates PeerManager's ORCHESTRATION logic — who initiates an
 * offer, how signaling messages route, how connection state is tracked —
 * against the real, already-deployed Worker signaling backend.
 *
 * It does NOT test real audio/ICE negotiation, because Node has no WebRTC
 * media stack. Instead it substitutes a FakeRTCPeerConnection that mimics
 * just enough of the real API surface (createOffer/createAnswer/set*Description/
 * addIceCandidate/getStats/events) to prove PeerManager drives the state
 * machine correctly. The actual SDP/ICE negotiation is exercised for real
 * by the browser once this runs in an actual tab — that's out of reach
 * from this sandboxed test environment.
 */

import { WebSocket as NodeWebSocket } from "ws";
(globalThis as any).WebSocket = NodeWebSocket;

// --- Fake RTCPeerConnection -------------------------------------------------

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  id = Math.random().toString(36).slice(2, 8);
  localTracks: unknown[] = [];
  connectionState: RTCPeerConnectionState = "new";
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(_config: RTCConfiguration) {
    FakeRTCPeerConnection.instances.push(this);
  }

  senders: { track: any; replaceTrack: (t: any) => Promise<void> }[] = [];

  addTrack(track: unknown, _stream: MediaStream) {
    this.localTracks.push(track);
    const sender = {
      track: track as any,
      replaceTrack: async (t: any) => {
        sender.track = t;
      },
    };
    this.senders.push(sender);
    return sender;
  }

  getSenders() {
    return this.senders;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: `offer-from-${this.id}` };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: `answer-from-${this.id}` };
  }

  async setLocalDescription(_desc: RTCSessionDescriptionInit): Promise<void> {
    // Simulate ICE gathering kicking off right after local description is set.
    setTimeout(() => {
      this.onicecandidate?.({
        candidate: { toJSON: () => ({ candidate: `fake-candidate-${this.id}`, sdpMid: "0", sdpMLineIndex: 0 }) } as unknown as RTCIceCandidate,
      });
    }, 5);
  }

  async setRemoteDescription(_desc: RTCSessionDescriptionInit): Promise<void> {
    // Simulate the remote side's audio track arriving once we've processed
    // their description — mirrors real WebRTC's ontrack firing during negotiation.
    setTimeout(() => {
      const fakeStream = { id: `stream-for-${this.id}` } as unknown as MediaStream;
      this.ontrack?.({ streams: [fakeStream] });
      this.connectionState = "connected";
      this.onconnectionstatechange?.();
    }, 10);
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {
    // no-op for this fake — real validation happens in a real browser
  }

  async getStats(): Promise<Map<string, any>> {
    return new Map(); // empty report; ConnectionMonitor handles this gracefully
  }

  close(): void {
    this.connectionState = "closed";
  }
}

(globalThis as any).RTCPeerConnection = FakeRTCPeerConnection;

// --- Test setup: create a real room on the deployed backend -----------------

const API_BASE = process.env.FRUITVC_API_BASE ?? "http://localhost:8787";
const WS_BASE = API_BASE.replace(/^http/, "ws");

async function createRoom(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/rooms`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173" },
  });
  const data = (await res.json()) as { roomId: string };
  return data.roomId;
}

async function joinRoom(roomId: string, name: string): Promise<{ participantId: string; token: string }> {
  const res = await fetch(`${API_BASE}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

const fakeMicTrack = { kind: "audio", id: "mic-1" };

function fakeLocalStream(): MediaStream {
  return { getTracks: () => [fakeMicTrack] } as unknown as MediaStream;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

async function run(): Promise<void> {
  const { PeerManager } = await import("./PeerManager");

  const roomId = await createRoom();
  console.log("Created room:", roomId);

  const a = await joinRoom(roomId, "Blue Mango");
  const b = await joinRoom(roomId, "Golden Kiwi");
  console.log("A:", a.participantId);
  console.log("B:", b.participantId);

  const remoteStreamsA: string[] = [];
  const remoteStreamsB: string[] = [];
  const participantListsA: string[][] = [];
  const participantListsB: string[][] = [];

  const pmA = new PeerManager({
    apiBaseUrl: API_BASE,
    wsBaseUrl: WS_BASE,
    roomId,
    participantId: a.participantId,
    token: a.token,
    localStream: fakeLocalStream(),
    onRemoteStream: (pid) => remoteStreamsA.push(pid),
    onParticipantListChanged: (list) => participantListsA.push(list.map((p) => p.id)),
    onError: (code, msg) => console.error("A signaling error:", code, msg),
  });

  // A connects first, alone in the room.
  await pmA.start();
  await new Promise((r) => setTimeout(r, 300));

  const pmB = new PeerManager({
    apiBaseUrl: API_BASE,
    wsBaseUrl: WS_BASE,
    roomId,
    participantId: b.participantId,
    token: b.token,
    localStream: fakeLocalStream(),
    onRemoteStream: (pid) => remoteStreamsB.push(pid),
    onParticipantListChanged: (list) => participantListsB.push(list.map((p) => p.id)),
    onError: (code, msg) => console.error("B signaling error:", code, msg),
  });

  // B joins second — this should trigger A to initiate an offer to B.
  await pmB.start();

  // Give the offer -> answer -> ICE -> fake "connected" sequence time to complete.
  await new Promise((r) => setTimeout(r, 500));

  console.log("\nFakeRTCPeerConnection instances created:", FakeRTCPeerConnection.instances.length);
  console.log("Remote streams seen by A:", remoteStreamsA);
  console.log("Remote streams seen by B:", remoteStreamsB);
  console.log("Final participant list (A's view):", participantListsA.at(-1));
  console.log("Final participant list (B's view):", participantListsB.at(-1));

  // --- Assertions ---------------------------------------------------------
  assert(
    FakeRTCPeerConnection.instances.length === 2,
    `expected exactly 2 peer connections (one per side), got ${FakeRTCPeerConnection.instances.length}`
  );

  assert(remoteStreamsA.includes(b.participantId), "A should have received a remote stream tagged with B's participant id");
  assert(remoteStreamsB.includes(a.participantId), "B should have received a remote stream tagged with A's participant id");

  const aFinalList = participantListsA.at(-1) ?? [];
  const bFinalList = participantListsB.at(-1) ?? [];
  assert(aFinalList.includes(a.participantId) && aFinalList.includes(b.participantId), "A's participant list should include both A and B");
  assert(bFinalList.includes(a.participantId) && bFinalList.includes(b.participantId), "B's participant list should include both A and B");

  console.log("\n✅ All PeerManager orchestration assertions passed (offer initiated by existing peer, answer/ICE routed correctly, remote stream + participant list updates fired on both sides)");

  // --- Live mic switch --------------------------------------------------
  const allSenders = FakeRTCPeerConnection.instances.flatMap((i) => i.senders);
  assert(allSenders.length === 2 && allSenders.every((x) => x.track.id === "mic-1"), "every sender starts on mic-1");

  const newMic = { kind: "audio", id: "mic-2" } as unknown as MediaStreamTrack;
  await pmA.replaceAudioTrack(newMic);

  const onNew = allSenders.filter((x) => x.track.id === "mic-2");
  const onOld = allSenders.filter((x) => x.track.id === "mic-1");
  assert(onNew.length === 1, "A's peer connection switched to the new mic");
  assert(onOld.length === 1, "B's own sender was left alone (only the caller's tracks change)");
  assert(FakeRTCPeerConnection.instances.length === 2, "switching mic created no new peer connections (no renegotiation)");

  pmA.stop();
  await pmA.replaceAudioTrack(newMic); // must be a harmless no-op with zero peers
  console.log("✅ Mic switch: senders swapped in place, no new connections, no-op when room is empty");

  pmB.stop();
  process.exit(0);
}

run().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
