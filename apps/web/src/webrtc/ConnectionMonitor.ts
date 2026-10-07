import type { ConnectionQuality, TurnProviderId, UsageReport } from "../../../../packages/shared/src/protocol";

/**
 * ConnectionMonitor — polls RTCPeerConnection.getStats() on a fixed interval
 * and derives two things from it:
 *
 *   1. Connection quality (excellent/good/poor), from RTT, packet loss, and jitter.
 *   2. Whether the connection is relayed through TURN, and if so, how many
 *      bytes it has used — which gets periodically reported back to the
 *      server so per-provider usage caps can be enforced (see usage.ts on
 *      the Worker side).
 *
 * This is the ONLY vantage point that can see this data — the signaling
 * server never touches the media path, so it has no way to know connection
 * quality or relay usage on its own. That's why this lives client-side and
 * self-reports, same pattern used by Discord/Zoom/Meet and WebRTC SDKs
 * like Twilio and LiveKit.
 */

export interface ConnectionStats {
  quality: ConnectionQuality;
  roundTripTimeMs: number | null;
  packetsLost: number;
  jitterMs: number | null;
  isRelayed: boolean;
  relayProvider: TurnProviderId | null;
  bytesSentDelta: number;
  bytesReceivedDelta: number;
}

export interface ConnectionMonitorOptions {
  pc: RTCPeerConnection;
  participantId: string; // the OTHER participant this connection is to (for logging/debug)
  roomId: string;
  myParticipantId: string;
  /** Which TURN provider issued the credentials used for this connection's ICE config, if any. */
  relayProvider: TurnProviderId | null;
  /** Called every poll with the latest derived stats. */
  onStats?: (stats: ConnectionStats) => void;
  /** How often to poll getStats(), in ms. Default 2500ms — frequent enough to feel live, cheap enough to not matter. */
  pollIntervalMs?: number;
  /** How often to flush accumulated relay usage to the server, in ms. Default 30s. */
  usageReportIntervalMs?: number;
  /** Base URL of the Worker API, e.g. "https://fruitvc-api.yoursubdomain.workers.dev" */
  apiBaseUrl: string;
}

export class ConnectionMonitor {
  private pc: RTCPeerConnection;
  private opts: Required<Omit<ConnectionMonitorOptions, "onStats">> & Pick<ConnectionMonitorOptions, "onStats">;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private usageReportTimer: ReturnType<typeof setInterval> | null = null;

  // Bytes accumulated since the last usage report flush (relayed traffic only).
  private unreportedBytesSent = 0;
  private unreportedBytesReceived = 0;
  private lastReportTime = Date.now();

  // Previous poll's raw byte counters, to compute per-interval deltas
  // (getStats() reports cumulative totals, not deltas).
  private prevBytesSent = 0;
  private prevBytesReceived = 0;

  private stopped = false;

  constructor(options: ConnectionMonitorOptions) {
    this.pc = options.pc;
    this.opts = {
      pollIntervalMs: 2500,
      usageReportIntervalMs: 30_000,
      onStats: options.onStats,
      ...options,
    };
  }

  start(): void {
    if (this.pollTimer) return; // already started
    this.pollTimer = setInterval(() => void this.poll(), this.opts.pollIntervalMs);
    this.usageReportTimer = setInterval(() => void this.flushUsageReport(), this.opts.usageReportIntervalMs);
    // Kick off an immediate poll rather than waiting for the first interval tick.
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.usageReportTimer) clearInterval(this.usageReportTimer);
    this.pollTimer = null;
    this.usageReportTimer = null;
    // Flush any remaining unreported usage before stopping, so a short call
    // at the end of a session isn't silently dropped from the totals.
    void this.flushUsageReport();
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;

    let report: Map<string, any>;
    try {
      // TypeScript's RTCStatsReport type only declares forEach(), but every
      // browser actually implements it as a real Map (per the W3C spec) —
      // this cast gets us .values()/.get() without losing real behavior.
      report = (await this.pc.getStats()) as unknown as Map<string, any>;
    } catch {
      return; // connection likely closed; next stop() call will clean up
    }

    let roundTripTimeMs: number | null = null;
    let packetsLost = 0;
    let jitterMs: number | null = null;
    let isRelayed = false;
    let bytesSent = 0;
    let bytesReceived = 0;

    // Find the currently active candidate pair to determine relay status
    // and get the most accurate RTT.
    let activeCandidatePairId: string | null = null;
    for (const stat of report.values()) {
      if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
        activeCandidatePairId = stat.selectedCandidatePairId;
      }
    }
    // Some browsers don't expose transport.selectedCandidatePairId; fall back
    // to scanning candidate-pair stats for the one marked nominated+succeeded.
    if (!activeCandidatePairId) {
      for (const stat of report.values()) {
        if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated) {
          activeCandidatePairId = stat.id;
          break;
        }
      }
    }

    for (const stat of report.values()) {
      if (stat.type === "candidate-pair" && stat.id === activeCandidatePairId) {
        if (typeof stat.currentRoundTripTime === "number") {
          roundTripTimeMs = stat.currentRoundTripTime * 1000;
        }
        if (typeof stat.bytesSent === "number") bytesSent += stat.bytesSent;
        if (typeof stat.bytesReceived === "number") bytesReceived += stat.bytesReceived;

        // Determine relay status from the LOCAL candidate type in this pair.
        const localCandidate = report.get(stat.localCandidateId as string);
        if (localCandidate?.type === "local-candidate" && localCandidate.candidateType === "relay") {
          isRelayed = true;
        }
      }

      if (stat.type === "inbound-rtp" && stat.kind === "audio") {
        if (typeof stat.packetsLost === "number") packetsLost += stat.packetsLost;
        if (typeof stat.jitter === "number") jitterMs = stat.jitter * 1000;
      }
    }

    // Compute this-interval deltas from cumulative counters.
    const sentDelta = Math.max(0, bytesSent - this.prevBytesSent);
    const receivedDelta = Math.max(0, bytesReceived - this.prevBytesReceived);
    this.prevBytesSent = bytesSent;
    this.prevBytesReceived = bytesReceived;

    // Only accumulate towards usage reporting if this connection is
    // actually relayed — direct P2P connections never touch a TURN
    // provider's bandwidth, so they shouldn't count against any cap.
    if (isRelayed) {
      this.unreportedBytesSent += sentDelta;
      this.unreportedBytesReceived += receivedDelta;
    }

    const quality = deriveQuality({ roundTripTimeMs, packetsLost, jitterMs });

    this.opts.onStats?.({
      quality,
      roundTripTimeMs,
      packetsLost,
      jitterMs,
      isRelayed,
      relayProvider: isRelayed ? this.opts.relayProvider : null,
      bytesSentDelta: sentDelta,
      bytesReceivedDelta: receivedDelta,
    });
  }

  private async flushUsageReport(): Promise<void> {
    if (this.unreportedBytesSent === 0 && this.unreportedBytesReceived === 0) return;
    if (!this.opts.relayProvider) return; // nothing relayed, nothing to report

    const windowSeconds = Math.max(1, Math.round((Date.now() - this.lastReportTime) / 1000));
    const report: UsageReport = {
      provider: this.opts.relayProvider,
      roomId: this.opts.roomId,
      participantId: this.opts.myParticipantId,
      bytesSent: this.unreportedBytesSent,
      bytesReceived: this.unreportedBytesReceived,
      windowSeconds,
    };

    // Reset counters optimistically before the network call so a slow
    // request doesn't cause double-counting on the next flush.
    this.unreportedBytesSent = 0;
    this.unreportedBytesReceived = 0;
    this.lastReportTime = Date.now();

    try {
      await fetch(`${this.opts.apiBaseUrl}/api/usage-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
    } catch {
      // Best-effort — a dropped usage report just means our server-side
      // cap tracking slightly undercounts for this window. Not worth
      // retrying/queuing for a friends-only project.
    }
  }
}

function deriveQuality(input: {
  roundTripTimeMs: number | null;
  packetsLost: number;
  jitterMs: number | null;
}): ConnectionQuality {
  const { roundTripTimeMs, packetsLost, jitterMs } = input;

  // No data yet (connection still negotiating) — treat as good rather than
  // alarming the user with "poor" before a baseline exists.
  if (roundTripTimeMs === null) return "good";

  // Thresholds chosen from general WebRTC/voice-quality guidance:
  // RTT < 150ms and jitter < 30ms are comfortably within "feels instant"
  // territory for voice; RTT > 300ms or significant packet loss is where
  // conversations start to feel broken.
  const poorRtt = roundTripTimeMs > 300;
  const poorJitter = jitterMs !== null && jitterMs > 50;
  const poorLoss = packetsLost > 50; // cumulative — a rough heuristic, not a rate

  if (poorRtt || poorJitter || poorLoss) return "poor";

  const goodRtt = roundTripTimeMs > 150;
  const goodJitter = jitterMs !== null && jitterMs > 30;

  if (goodRtt || goodJitter) return "good";

  return "excellent";
}
