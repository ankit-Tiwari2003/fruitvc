import type { ReactNode } from "react";

/** One label/value line in the sidebar, with a divider underneath. */
export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
