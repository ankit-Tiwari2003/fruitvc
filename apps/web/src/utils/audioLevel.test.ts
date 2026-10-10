import { rmsDb, dbToMeter, classifyPeak } from "./audioLevel";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}
const near = (a: number, b: number, eps = 0.05) => Math.abs(a - b) < eps;

assert(rmsDb(new Float32Array(1024)) === -100, "silence reads -100 dB (no -Infinity)");
assert(near(rmsDb(new Float32Array(1024).fill(1)), 0), "full-scale signal reads 0 dB");
assert(near(rmsDb(new Float32Array(1024).fill(0.1)), -20), "0.1 amplitude reads -20 dB");
const sine = Float32Array.from({ length: 1024 }, (_, i) => Math.sin((2 * Math.PI * 8 * i) / 1024));
assert(near(rmsDb(sine), -3.01), "full-scale sine reads -3 dB");

assert(dbToMeter(-60) === 0 && dbToMeter(0) === 1, "meter endpoints are 0 and 1");
assert(near(dbToMeter(-30), 0.5, 1e-9), "-30 dB sits mid-meter");
assert(dbToMeter(-100) === 0 && dbToMeter(10) === 1, "meter clamps out-of-range values");

assert(classifyPeak(-20) === "good", "-20 dB is good");
assert(classifyPeak(-40) === "good", "-40 dB (boundary) is good");
assert(classifyPeak(-41) === "low", "-41 dB is low");
assert(classifyPeak(-55) === "low", "-55 dB (boundary) is low");
assert(classifyPeak(-56) === "silent", "-56 dB is silent");
assert(classifyPeak(-100) === "silent", "-100 dB is silent");
