import { useEffect, useState } from "react";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * Lists the audio input devices the browser exposes. Labels are only
 * populated once mic permission has been granted, so pass `ready` = true
 * after the first getUserMedia succeeds. Refreshes on plug/unplug.
 */
export function useAudioInputs(ready: boolean): AudioInputDevice[] {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);

  useEffect(() => {
    if (!ready || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;

    const refresh = async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setDevices(
        all
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
      );
    };

    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [ready]);

  return devices;
}
