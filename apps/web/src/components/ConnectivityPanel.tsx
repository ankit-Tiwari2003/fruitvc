import { StatRow } from "./StatRow";
import type { RelayStatus } from "../webrtc/IceManager";

const LABEL: Record<RelayStatus, { text: string; cls: string }> = {
  working: { text: "Available", cls: "q-excellent" },
  unavailable: { text: "Not reachable", cls: "q-poor" },
  unconfigured: { text: "Not set up", cls: "q-good" },
  unknown: { text: "Checking…", cls: "" },
};

const HINT: Partial<Record<RelayStatus, string>> = {
  unavailable: "Devices on different networks may not be able to hear each other until the relay works.",
  unconfigured: "No relay is configured. Devices on different networks may not be able to connect.",
};

/**
 * Whether the fallback relay (TURN) works from this device. Direct connections
 * hide this problem completely: everything looks fine until two people on
 * different networks try to talk and neither can.
 */
export function ConnectivityPanel({
  relay,
  relayTestMode,
}: {
  relay: { status: RelayStatus; detail?: string };
  relayTestMode: boolean;
}) {
  const { text, cls } = LABEL[relay.status];
  return (
    <section className="panel">
      <h3>Connectivity</h3>
      <div className="rows">
        <StatRow
          label="Relay (TURN)"
          value={
            <span className={`badge ${cls}`}>
              <span className="dot" />
              {text}
            </span>
          }
        />
        {relayTestMode && <StatRow label="Mode" value="Relay-only test" />}
      </div>
      {HINT[relay.status] && <p className="muted small">{HINT[relay.status]}</p>}
      {relay.detail && <p className="muted small">Detail: {relay.detail}</p>}
    </section>
  );
}
