import { MicMeter } from "./MicMeter";
import type { AudioInputDevice } from "../hooks/useAudioInputs";

export interface SettingsPanelProps {
  devices: AudioInputDevice[];
  activeDeviceId: string | null;
  micTrack: MediaStreamTrack | null;
  micError: string | null;
  onSelectMic: (deviceId: string) => void;
  pushToTalk: boolean;
  onPushToTalkChange: (enabled: boolean) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
}

export function SettingsPanel({
  devices,
  activeDeviceId,
  micTrack,
  micError,
  onSelectMic,
  pushToTalk,
  onPushToTalkChange,
  volume,
  onVolumeChange,
}: SettingsPanelProps) {
  const activeListed = devices.some((d) => d.deviceId === activeDeviceId);
  return (
    <section className="panel">
      <h3>Settings</h3>

      <div className="setting setting--col">
        <span>Microphone</span>
        <select
          className="select"
          value={activeListed ? (activeDeviceId ?? "") : ""}
          onChange={(e) => onSelectMic(e.target.value)}
        >
          {!activeListed && (
            <option value="" disabled>
              Current microphone
            </option>
          )}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        <MicMeter track={micTrack} />
        {micError && <p className="error">{micError}</p>}
        {devices.length < 2 && (
          <p className="muted small">
            Your browser lists only one microphone, so there's nothing to switch to. Phones usually expose a single
            combined mic; a headset, Bluetooth or USB mic appears here once connected.
          </p>
        )}
      </div>

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
