import { useEffect, useState } from "react";
import { classifyPeak, dbToMeter, rmsDb, type LevelStatus } from "../utils/audioLevel";

export interface MicLevel {
  db: number;
  peakDb: number;
  /** 0..1 position for a meter bar. */
  meter: number;
  status: LevelStatus;
}

const IDLE: MicLevel = { db: -100, peakDb: -100, meter: 0, status: "silent" };
const POLL_MS = 100;
const PEAK_WINDOW = 50; // 50 * 100ms = loudest reading over the last 5 seconds

/**
 * Live input level for a mic track. Measures a CLONE of the track, so the
 * meter keeps working while the real track is disabled (muted / push-to-talk
 * idle) — you can still test a mic before deciding to use it. The analyser
 * is never connected to the speakers, so there is no feedback.
 */
export function useMicLevel(track: MediaStreamTrack | null): MicLevel {
  const [level, setLevel] = useState<MicLevel>(IDLE);

  useEffect(() => {
    if (!track) {
      setLevel(IDLE);
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const clone = track.clone();
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(new MediaStream([clone]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    const history: number[] = [];

    // Browsers start AudioContexts suspended until a user gesture.
    const resume = () => {
      if (ctx.state === "suspended") void ctx.resume();
    };
    resume();
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);

    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const db = rmsDb(buf);
      history.push(db);
      if (history.length > PEAK_WINDOW) history.shift();
      const peakDb = Math.max(...history);
      setLevel({ db, peakDb, meter: dbToMeter(db), status: classifyPeak(peakDb) });
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      source.disconnect();
      clone.stop();
      void ctx.close();
    };
  }, [track]);

  return level;
}
