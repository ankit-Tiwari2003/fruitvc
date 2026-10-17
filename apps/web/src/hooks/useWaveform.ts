import { useEffect, useState } from "react";
import { SPEAKING_HOLD_MS, SPEAKING_OFF_DB, SPEAKING_ON_DB, dbToWave, rmsDb } from "../utils/audioLevel";
import { sharedAudioContext } from "../utils/audioContext";

export const WAVE_BARS = 24;
const POLL_MS = 80; // 24 bars x 80ms = the last ~2 seconds

export interface Waveform {
  /** 0..1 heights, oldest first. */
  bars: number[];
  speaking: boolean;
}

const flat = (): Waveform => ({ bars: new Array<number>(WAVE_BARS).fill(0), speaking: false });

/**
 * Live loudness history + speaking flag for an audio source.
 * Pass a remote MediaStream to see whether someone else is talking, or the
 * local mic track (only while it's actually transmitting) for yourself.
 * Pass null for a flat line. Nothing here is connected to the speakers.
 */
export function useWaveform(source: MediaStream | MediaStreamTrack | null): Waveform {
  const [wave, setWave] = useState<Waveform>(flat);

  useEffect(() => {
    if (!source) {
      setWave(flat());
      return;
    }
    const ctx = sharedAudioContext();
    if (!ctx) return;
    const stream = source instanceof MediaStream ? source : new MediaStream([source]);
    if (stream.getAudioTracks().length === 0) {
      setWave(flat());
      return;
    }
    if (ctx.state === "suspended") void ctx.resume();

    const node = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    const bars = new Array<number>(WAVE_BARS).fill(0);
    let speaking = false;
    let quietSince: number | null = null;

    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const db = rmsDb(buf);
      const now = performance.now();

      if (db > SPEAKING_ON_DB) speaking = true;
      if (db >= SPEAKING_OFF_DB) quietSince = null;
      else if (quietSince === null) quietSince = now;
      if (speaking && quietSince !== null && now - quietSince > SPEAKING_HOLD_MS) speaking = false;

      bars.shift();
      bars.push(dbToWave(db));
      setWave({ bars: [...bars], speaking });
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      node.disconnect();
    };
  }, [source]);

  return wave;
}
