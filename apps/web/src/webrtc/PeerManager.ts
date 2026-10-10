import type { Participant, TurnProviderId } from "../../../../packages/shared/src/protocol";
import { SignalingClient } from "./SignalingClient";
import { fetchIceConfig, type IceConfig } from "./IceManager";
import { ConnectionMonitor, type ConnectionStats } from "./ConnectionMonitor";

/**
 * PeerManager — owns the WebRTC mesh for a room.
 *
 * Connection initiation follows the spec's rule: when a NEW participant
 * joins, every EXISTING participant initiates an offer to them (not the
 * other way around). This avoids the classic WebRTC "glare" problem where
 * both sides try to create an offer simultaneously — only one side ever
 * calls createOffer() for a given pair.
 *
 * This class deliberately does NOT touch audio encoding/decoding itself —
 * it just wires the local MediaStreamTrack into each RTCPeerConnection and
 * exposes remote tracks via a callback. The browser's WebRTC stack handles
 * everything about the actual audio path.
 */

export interface PeerManagerOptions {
  apiBaseUrl: string; // e.g. "https://fruitvc-api.yoursubdomain.workers.dev"
  wsBaseUrl: string; // e.g. "wss://fruitvc-api.yoursubdomain.workers.dev"
  roomId: string;
  participantId: string;
  token: string;
  localStream: MediaStream;
  onRemoteStream?: (participantId: string, stream: MediaStream) => void;
  onParticipantListChanged?: (participants: Participant[]) => void;
  onConnectionStats?: (participantId: string, stats: ConnectionStats) => void;
  onError?: (code: string, message: string) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  monitor: ConnectionMonitor;
}

export class PeerManager {
  private opts: PeerManagerOptions;
  private signaling: SignalingClient;
  private peers = new Map<string, PeerEntry>();
  private knownParticipants = new Map<string, Participant>();
  private iceConfig: IceConfig | null = null;

  constructor(options: PeerManagerOptions) {
    this.opts = options;
    this.signaling = new SignalingClient({
      wsBaseUrl: options.wsBaseUrl,
      roomId: options.roomId,
      participantId: options.participantId,
      token: options.token,
      events: {
        onWelcome: (you, existing) => this.handleWelcome(you, existing),
        onParticipantJoined: (id, name) => this.handleParticipantJoined(id, name),
        onParticipantLeft: (id) => this.handleParticipantLeft(id),
        onOffer: (from, sdp) => void this.handleOffer(from, sdp),
        onAnswer: (from, sdp) => void this.handleAnswer(from, sdp),
        onIceCandidate: (from, candidate) => void this.handleIceCandidate(from, candidate),
        onError: (code, message) => options.onError?.(code, message),
        onClose: () => this.handleSignalingClosed(),
      },
    });
  }

  /** Fetches ICE config, then opens the signaling connection. Call once. */
  async start(): Promise<void> {
    this.iceConfig = await fetchIceConfig(this.opts.apiBaseUrl);
    this.signaling.connect();
  }

  stop(): void {
    for (const [id] of this.peers) this.closePeer(id);
    this.signaling.close();
  }

  /**
   * Swaps the outgoing audio track on every existing peer connection.
   * RTCRtpSender.replaceTrack needs no SDP renegotiation, so remote peers
   * hear the new mic seamlessly. Connections created afterwards pick up the
   * new track automatically because the shared localStream is updated by
   * the caller (see useLocalStream.commitTrack).
   */
  async replaceAudioTrack(newTrack: MediaStreamTrack): Promise<void> {
    await Promise.all(
      [...this.peers.entries()].map(async ([participantId, { pc }]) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
        if (!sender) return;
        try {
          await sender.replaceTrack(newTrack);
        } catch (err) {
          console.warn(`Could not switch mic for peer ${participantId}:`, err);
        }
      })
    );
  }

  // --- signaling event handlers ---------------------------------------------

  private handleWelcome(you: Participant, existing: Participant[]): void {
    this.knownParticipants.set(you.id, you);
    for (const p of existing) this.knownParticipants.set(p.id, p);
    // Per the spec's initiation rule, the NEW joiner does NOT initiate —
    // it waits for offers from each existing participant.
    this.emitParticipantList();
  }

  private handleParticipantJoined(participantId: string, name: string): void {
    this.knownParticipants.set(participantId, { id: participantId, name, joinedAt: Date.now() });
    this.emitParticipantList();
    // We were already in the room, so WE initiate the offer to the newcomer.
    void this.initiateConnection(participantId);
  }

  private handleParticipantLeft(participantId: string): void {
    this.knownParticipants.delete(participantId);
    this.closePeer(participantId);
    this.emitParticipantList();
  }

  private async handleOffer(from: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.getOrCreatePeerConnection(from);
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.sendAnswer(from, answer);
  }

  private async handleAnswer(from: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry) return; // answer for a connection we no longer have; ignore
    await entry.pc.setRemoteDescription(sdp);
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry) return;
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (err) {
      // Late-arriving candidates for an already-failed/closed connection
      // are expected during teardown races; don't treat as fatal.
      console.warn(`Failed to add ICE candidate from ${from}:`, err);
    }
  }

  private handleSignalingClosed(): void {
    for (const [id] of this.peers) this.closePeer(id);
  }

  // --- peer connection lifecycle ---------------------------------------------

  private async initiateConnection(participantId: string): Promise<void> {
    const pc = this.getOrCreatePeerConnection(participantId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendOffer(participantId, offer);
  }

  private getOrCreatePeerConnection(participantId: string): RTCPeerConnection {
    const existing = this.peers.get(participantId);
    if (existing) return existing.pc;

    const pc = new RTCPeerConnection({ iceServers: this.iceConfig?.iceServers ?? [] });

    for (const track of this.opts.localStream.getTracks()) {
      pc.addTrack(track, this.opts.localStream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(participantId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) this.opts.onRemoteStream?.(participantId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(participantId);
      }
    };

    const monitor = new ConnectionMonitor({
      pc,
      participantId,
      myParticipantId: this.opts.participantId,
      roomId: this.opts.roomId,
      relayProvider: this.iceConfig?.relayProvider ?? null,
      apiBaseUrl: this.opts.apiBaseUrl,
      onStats: (stats) => this.opts.onConnectionStats?.(participantId, stats),
    });
    monitor.start();

    this.peers.set(participantId, { pc, monitor });
    return pc;
  }

  private closePeer(participantId: string): void {
    const entry = this.peers.get(participantId);
    if (!entry) return;
    entry.monitor.stop();
    entry.pc.close();
    this.peers.delete(participantId);
  }

  private emitParticipantList(): void {
    this.opts.onParticipantListChanged?.([...this.knownParticipants.values()]);
  }

  /** Relay provider currently in use for new connections, for UI display. */
  getRelayProvider(): TurnProviderId | null {
    return this.iceConfig?.relayProvider ?? null;
  }
}
