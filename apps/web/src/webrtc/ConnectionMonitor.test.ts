import { ConnectionMonitor, type ConnectionStats } from "./ConnectionMonitor";

// --- Mock fetch so usage reports can be captured and inspected -------------
const sentReports: unknown[] = [];
(globalThis as any).fetch = async (_url: string, init: RequestInit) => {
  sentReports.push(JSON.parse(init.body as string));
  return { ok: true, json: async () => ({ ok: true }) } as Response;
};

// --- Build a fake RTCStatsReport (just a Map, which satisfies the shape) ---
function buildStatsReport(opts: {
  rttSeconds: number;
  packetsLost: number;
  jitterSeconds: number;
  bytesSent: number;
  bytesReceived: number;
  relayed: boolean;
}): RTCStatsReport {
  const map = new Map<string, any>();

  map.set("transport-1", {
    type: "transport",
    selectedCandidatePairId: "pair-1",
  });

  map.set("local-cand-1", {
    type: "local-candidate",
    candidateType: opts.relayed ? "relay" : "srflx",
  });

  map.set("pair-1", {
    type: "candidate-pair",
    id: "pair-1",
    state: "succeeded",
    nominated: true,
    currentRoundTripTime: opts.rttSeconds,
    bytesSent: opts.bytesSent,
    bytesReceived: opts.bytesReceived,
    localCandidateId: "local-cand-1",
  });

  map.set("inbound-rtp-audio-1", {
    type: "inbound-rtp",
    kind: "audio",
    packetsLost: opts.packetsLost,
    jitter: opts.jitterSeconds,
  });

  return map as unknown as RTCStatsReport;
}

async function run() {
  let statsHistory: ConnectionStats[] = [];
  let callIndex = 0;

  // Simulated sequence of poll results: starts excellent, degrades to poor,
  // and switches from direct to relayed partway through.
  const scenarios = [
    { rttSeconds: 0.02, packetsLost: 0, jitterSeconds: 0.005, bytesSent: 10_000, bytesReceived: 10_000, relayed: false },
    { rttSeconds: 0.18, packetsLost: 2, jitterSeconds: 0.02, bytesSent: 20_000, bytesReceived: 20_000, relayed: false },
    { rttSeconds: 0.35, packetsLost: 60, jitterSeconds: 0.06, bytesSent: 30_000, bytesReceived: 30_000, relayed: true },
    { rttSeconds: 0.33, packetsLost: 70, jitterSeconds: 0.055, bytesSent: 1_030_000, bytesReceived: 1_030_000, relayed: true },
  ];

  const fakePc = {
    getStats: async () => {
      const scenario = scenarios[Math.min(callIndex, scenarios.length - 1)];
      callIndex++;
      return buildStatsReport(scenario);
    },
  } as unknown as RTCPeerConnection;

  const monitor = new ConnectionMonitor({
    pc: fakePc,
    participantId: "peer-B",
    myParticipantId: "peer-A",
    roomId: "TEST01",
    relayProvider: "openrelay",
    apiBaseUrl: "https://fake-api.example.com",
    pollIntervalMs: 50,
    usageReportIntervalMs: 10_000_000, // disable auto-flush timer; we'll flush manually
    onStats: (stats) => statsHistory.push(stats),
  });

  monitor.start();

  // Wait for all 4 scenarios to be polled.
  await new Promise((r) => setTimeout(r, 50 * (scenarios.length + 1)));
  monitor.stop(); // this triggers a final flush

  // Give the final flush's async fetch call a moment to land.
  await new Promise((r) => setTimeout(r, 20));

  console.log("Poll count:", statsHistory.length);
  console.log("Quality sequence:", statsHistory.map((s) => s.quality).join(" -> "));
  console.log("Relay flags:", statsHistory.map((s) => s.isRelayed).join(", "));
  console.log("Usage reports sent:", JSON.stringify(sentReports, null, 2));

  // --- Assertions -------------------------------------------------------
  const quals = statsHistory.map((s) => s.quality);
  assert(quals[0] === "excellent", `expected first poll excellent, got ${quals[0]}`);
  assert(quals[2] === "poor", `expected third poll poor, got ${quals[2]}`);

  const relayFlags = statsHistory.map((s) => s.isRelayed);
  assert(relayFlags[0] === false, "expected first poll not relayed");
  assert(relayFlags[2] === true, "expected third poll relayed");

  assert(sentReports.length >= 1, "expected at least one usage report to be sent");
  const report = sentReports[0] as any;
  assert(report.provider === "openrelay", `expected provider openrelay, got ${report.provider}`);
  // Only scenarios 3 and 4 were relayed; scenario 3's delta vs scenario 2
  // (30000-20000=10000) and scenario 4's delta vs scenario 3 (1030000-30000=1000000)
  // sent+received should sum to roughly 2 * (10000 + 1000000) = 2,020,000
  const expectedBytes = 2 * (10_000 + 1_000_000);
  assert(
    report.bytesSent + report.bytesReceived === expectedBytes,
    `expected total relayed bytes ${expectedBytes}, got ${report.bytesSent + report.bytesReceived}`
  );
  // Direct (non-relayed) traffic from scenario 1->2 must NOT be counted.
  console.log(`\n✅ All assertions passed. Relayed-only bytes correctly isolated: ${report.bytesSent + report.bytesReceived} bytes`);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
