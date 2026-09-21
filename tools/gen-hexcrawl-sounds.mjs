#!/usr/bin/env node
/**
 * GLUniverse Suite — Hexcrawl sound generator.
 *
 *   node tools/gen-hexcrawl-sounds.mjs          write assets/hexcrawl/{reveal,step}.wav
 *   node tools/gen-hexcrawl-sounds.mjs --check  verify they exist and parse
 *
 * No dependencies: a seeded PRNG, a few one-pole / state-variable filters and a
 * 16-bit mono PCM writer. Deterministic, so re-running produces byte-identical
 * files and a diff means the recipe changed.
 *
 *   reveal.wav  ~0.7s  a soft airy whoosh: band-passed noise whose centre sweeps
 *                      upward under a slow swell, a faint high shimmer (three
 *                      detuned partials, gently tremoloed) riding the tail, and
 *                      long raised-cosine fades so nothing clicks. Peak ~-9 dBFS.
 *   step.wav   ~0.15s a muted footfall: a low damped thump plus a very short
 *                      low-passed noise scuff. Peak ~-10 dBFS.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "hexcrawl");
const RATE = 44100;

/* ── helpers ── */

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raised-cosine fade in over [0,a], hold, fade out over the last r seconds. */
function envelope(t, dur, a, r) {
  if (t < a) return 0.5 - 0.5 * Math.cos(Math.PI * (t / a));
  if (t > dur - r) return 0.5 + 0.5 * Math.cos(Math.PI * ((t - (dur - r)) / r));
  return 1;
}

/** Chamberlin state-variable filter; returns band-pass by default. */
function svf() {
  let low = 0, band = 0;
  return (x, fc, q) => {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, RATE / 6) / RATE);
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return { low, band, high };
  };
}

function normalize(buf, peakDb) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const target = 10 ** (peakDb / 20);
  const k = peak > 0 ? target / peak : 1;
  return buf.map((v) => v * k);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/* ── recipes ── */

function reveal() {
  const dur = 0.72, n = Math.round(dur * RATE);
  const rnd = mulberry32(0x9e3779b9);
  const f1 = svf(), f2 = svf();
  const out = new Float64Array(n);
  let pink = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, p = t / dur;
    // Softened noise (one-pole low-passed white → gentler than raw white).
    const white = rnd() * 2 - 1;
    pink = pink * 0.86 + white * 0.14;
    // Centre sweeps 500 Hz → 3.2 kHz along an ease-out curve: air rushing in.
    const sweep = 500 + 2700 * (1 - (1 - p) ** 2);
    const b1 = f1(pink, sweep, 1.1).band;
    const b2 = f2(b1, sweep * 1.3, 1.4).band;
    // Swell peaks a little past the middle, then eases away.
    const swell = Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 1.6;
    let v = b2 * 2.2 * swell;
    // Shimmer: three detuned high partials, entering late, tremoloed.
    const sh = Math.max(0, (p - 0.28) / 0.72);
    const trem = 0.65 + 0.35 * Math.sin(2 * Math.PI * 9 * t);
    const shimmer = (Math.sin(2 * Math.PI * 2637 * t) + 0.7 * Math.sin(2 * Math.PI * 3951 * t + 1.3)
      + 0.45 * Math.sin(2 * Math.PI * 5274 * t + 0.4)) * 0.018 * sh * (1 - p) * 2.4 * trem;
    v += shimmer;
    out[i] = v * envelope(t, dur, 0.06, 0.28);
  }
  return normalize(Array.from(out), -9);
}

function step() {
  const dur = 0.15, n = Math.round(dur * RATE);
  const rnd = mulberry32(0x51ed270b);
  const f = svf();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    // Thump: a pitch-dropping sine, 150 → 70 Hz, fast exponential decay.
    const freq = 70 + 80 * Math.exp(-t * 40);
    const thump = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 32);
    // Scuff: low-passed noise burst, very short.
    const scuff = f(rnd() * 2 - 1, 900, 0.9).low * Math.exp(-t * 55) * 0.55;
    out[i] = (thump * 0.9 + scuff) * envelope(t, dur, 0.004, 0.05);
  }
  return normalize(Array.from(out), -10);
}

/* ── main ── */

const FILES = { "reveal.wav": reveal, "step.wav": step };

if (process.argv.includes("--check")) {
  let problems = 0;
  for (const name of Object.keys(FILES)) {
    const p = join(OUT, name);
    if (!existsSync(p)) { console.log(`MISSING ${p}`); problems++; continue; }
    const b = readFileSync(p);
    const ok = b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" && b.readUInt32LE(24) === RATE;
    console.log(`${ok ? "  ok  " : "FAIL  "} ${name} (${b.length} bytes)`);
    if (!ok) problems++;
  }
  process.exit(problems ? 1 : 0);
}

mkdirSync(OUT, { recursive: true });
for (const [name, fn] of Object.entries(FILES)) {
  const buf = wav(fn());
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote assets/hexcrawl/${name} (${buf.length} bytes)`);
}
