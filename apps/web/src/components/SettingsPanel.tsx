export interface SettingsPanelProps {
  pushToTalk: boolean;
  onPushToTalkChange: (enabled: boolean) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
}

export function SettingsPanel({ pushToTalk, onPushToTalkChange, volume, onVolumeChange }: SettingsPanelProps) {
  return (
    <section className="panel">
      <h3>Settings</h3>
      <label className="setting">
        <input type="checkbox" checked={pushToTalk} onChange={(e) => onPushToTalkChange(e.target.checked)} />
        <span>Push to talk (hold Space)</span>
      </label>
      <label className="setting setting--col">
        <span>Volume · {Math.round(volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
