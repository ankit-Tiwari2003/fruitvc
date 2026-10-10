export type LevelStatus = "good" | "low" | "silent";

/** Loudness of a block of samples (-1..1) in dBFS. Silence is clamped to -100. */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

/** Maps dBFS to a 0..1 meter position (-60 dB = empty, 0 dB = full). */
export function dbToMeter(db: number): number {
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

// Heuristics: normal speech with auto-gain lands well above -40 dBFS, while a
// weak or blocked mic stays near its noise floor. Tweak here if they feel off.
export const GOOD_DB = -40;
export const SILENT_DB = -55;

/** Classifies the loudest reading over the recent window (not the instant). */
export function classifyPeak(peakDb: number): LevelStatus {
  if (peakDb >= GOOD_DB) return "good";
  if (peakDb >= SILENT_DB) return "low";
  return "silent";
}
