#!/usr/bin/env node
/**
 * GLUniverse Suite — Combat Intro sound generator (the "etched" cue set).
 *
 *   node tools/gen-combat-intro-sounds.mjs          write assets/combat-intro/etched/<cue>.wav
 *   node tools/gen-combat-intro-sounds.mjs --check  verify every cue in CUES exists and parses
 *
 * No dependencies: a seeded PRNG, a state-variable filter and a 16-bit mono
 * PCM writer. Deterministic, so re-running produces byte-identical files and a
 * diff means a recipe changed. The palette is glass and machinery: struck
 * glass partials (inharmonic, like a real bar or bowl), synthetic sweeps, a
 * sub hit under the two big beats, crisp ticks for the counts.
 *
 *   introHit   ~1.5s  sub drop + air burst + a long glass shimmer tail
 *   rosterTick ~0.09s a crisp data tick
 *   titleSlam  ~1.7s  sub hit + struck glass chord + a rising swell into it
 *   throw      ~0.4s  a fast synthetic whoosh
 *   dieLand    ~0.3s  a glassy clack
 *   seal       ~0.35s a muted, closed thud with a dull ping
 *   sortTick   ~0.08s a lower, drier tick
 *   dockIn     ~0.6s  a docking clunk: two thumps and a metallic ring
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CUES } from "../scripts/features/combat-intro/constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "combat-intro", "etched");
const RATE = 44100;
const TAU = Math.PI * 2;

/* ── helpers ── */

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raised-cosine fade in over [0,a], fade out over the last r seconds. */
function envelope(t, dur, a, r) {
  if (t < a) return 0.5 - 0.5 * Math.cos(Math.PI * (t / a));
  if (t > dur - r) return 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (t - (dur - r)) / r));
  return 1;
}

/** Chamberlin state-variable filter. */
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
  const k = peak > 0 ? 10 ** (peakDb / 20) / peak : 1;
  return Array.from(buf, (v) => v * k);
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

function render(dur, fn) {
  const n = Math.round(dur * RATE), out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, i);
  return out;
}

/** A struck glass bar: inharmonic partials, each decaying faster the higher it sits. */
function glass(t, f0, decay, partials = [1, 2.756, 5.404, 8.933], amps = [1, 0.55, 0.3, 0.16]) {
  let v = 0;
  for (let k = 0; k < partials.length; k++) v += amps[k] * Math.sin(TAU * f0 * partials[k] * t) * Math.exp(-t * decay * (1 + k * 0.8));
  return v;
}

/** A pitch-dropping sine: the sub under a hit. */
function sub(t, from, to, drop, decay) {
  const f = to + (from - to) * Math.exp(-t * drop);
  // integrate the frequency so the drop does not click
  const phase = TAU * (to * t + (from - to) * (1 - Math.exp(-t * drop)) / drop);
  return Math.sin(phase) * Math.exp(-t * decay) * (f > 0 ? 1 : 0);
}

/* ── recipes ── */

function introHit() {
  const dur = 1.5, rnd = mulberry32(0x1a2b3c4d), f1 = svf();
  return normalize(render(dur, (t) => {
    const boom = sub(t, 120, 38, 9, 3.2) * 1.0;
    const air = f1(rnd() * 2 - 1, 1800 - 1200 * Math.min(1, t * 3), 1.2).band * Math.exp(-t * 9) * 1.4;
    const shimmer = glass(Math.max(0, t - 0.04), 1318, 2.1) * 0.12 * Math.min(1, t * 20);
    return (boom + air + shimmer) * envelope(t, dur, 0.002, 0.4);
  }), -6);
}

function rosterTick() {
  const dur = 0.09, rnd = mulberry32(0x77aa11), f = svf();
  return normalize(render(dur, (t) => {
    const click = f(rnd() * 2 - 1, 5200, 0.5).band * Math.exp(-t * 260);
    const ping = Math.sin(TAU * 2350 * t) * Math.exp(-t * 70) * 0.35;
    return (click + ping) * envelope(t, dur, 0.0008, 0.03);
  }), -12);
}

function titleSlam() {
  const dur = 1.7, pre = 0.22, rnd = mulberry32(0x5eed01), f1 = svf(), f2 = svf();
  return normalize(render(dur, (t) => {
    // a short rising swell into the strike
    const sw = t < pre ? f1(rnd() * 2 - 1, 600 + 4200 * (t / pre) ** 2, 1.0).band * (t / pre) ** 2 * 0.9 : 0;
    const u = t - pre;
    if (u < 0) return sw * envelope(t, dur, 0.01, 0.4);
    const boom = sub(u, 140, 42, 11, 3.6);
    const crack = f2(rnd() * 2 - 1, 3200, 0.8).band * Math.exp(-u * 40) * 0.9;
    const chord = (glass(u, 659, 1.6) + glass(u, 988, 1.9) * 0.7 + glass(u, 1319, 2.4) * 0.45) * 0.22;
    return (sw * Math.exp(-u * 30) + boom + crack + chord) * envelope(t, dur, 0.01, 0.45);
  }), -5);
}

function throwCue() {
  const dur = 0.4, rnd = mulberry32(0x7400), f1 = svf(), f2 = svf();
  let pink = 0;
  return normalize(render(dur, (t) => {
    const p = t / dur;
    pink = pink * 0.8 + (rnd() * 2 - 1) * 0.2;
    const fc = 700 + 3800 * Math.sin(Math.PI * Math.min(1, p * 1.1)) ** 1.5;
    const v = f2(f1(pink, fc, 1.0).band, fc * 1.25, 1.3).band * 2.6;
    return v * Math.sin(Math.PI * p) ** 1.4 * envelope(t, dur, 0.01, 0.08);
  }), -11);
}

function dieLand() {
  const dur = 0.3, rnd = mulberry32(0xd1e), f = svf();
  return normalize(render(dur, (t) => {
    const tap = f(rnd() * 2 - 1, 2600, 0.6).band * Math.exp(-t * 120) * 1.2;
    const body = Math.sin(TAU * 230 * t) * Math.exp(-t * 45) * 0.4;
    const ring = glass(t, 2420, 9, [1, 2.31, 3.89], [1, 0.5, 0.25]) * 0.35;
    return (tap + body + ring) * envelope(t, dur, 0.0006, 0.08);
  }), -8);
}

function seal() {
  const dur = 0.35, rnd = mulberry32(0x5ea1), f = svf();
  return normalize(render(dur, (t) => {
    const thud = sub(t, 160, 70, 30, 18);
    const scuff = f(rnd() * 2 - 1, 700, 0.9).low * Math.exp(-t * 60) * 0.5;
    const ping = Math.sin(TAU * 420 * t) * Math.exp(-t * 16) * 0.22;
    return (thud + scuff + ping) * envelope(t, dur, 0.002, 0.1);
  }), -10);
}

function sortTick() {
  const dur = 0.08, rnd = mulberry32(0x50f7), f = svf();
  return normalize(render(dur, (t) => {
    const click = f(rnd() * 2 - 1, 3100, 0.6).band * Math.exp(-t * 300);
    const ping = Math.sin(TAU * 1560 * t) * Math.exp(-t * 90) * 0.3;
    return (click + ping) * envelope(t, dur, 0.0008, 0.03);
  }), -13);
}

function dockIn() {
  const dur = 0.6, rnd = mulberry32(0xd0c), f = svf();
  return normalize(render(dur, (t) => {
    const thump = (u) => (u < 0 ? 0 : sub(u, 110, 55, 40, 22) + f(rnd() * 2 - 1, 900, 0.8).low * Math.exp(-u * 70) * 0.4);
    const ring = (Math.sin(TAU * 182 * t) * 0.6 + Math.sin(TAU * 547 * t) * 0.35 + Math.sin(TAU * 1093 * t) * 0.15) * Math.exp(-t * 7) * 0.22 * Math.min(1, t * 40);
    return (thump(t) * 0.7 + thump(t - 0.065) + ring) * envelope(t, dur, 0.001, 0.2);
  }), -7);
}

/* ── main ── */

const RECIPES = { introHit, rosterTick, titleSlam, throw: throwCue, dieLand, seal, sortTick, dockIn };

if (process.argv.includes("--check")) {
  let problems = 0;
  for (const cue of CUES) {
    if (!RECIPES[cue]) { console.log(`NO RECIPE ${cue}`); problems++; continue; }
    const p = join(OUT, `${cue}.wav`);
    if (!existsSync(p)) { console.log(`MISSING ${p}`); problems++; continue; }
    const b = readFileSync(p);
    const ok = b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" && b.readUInt32LE(24) === RATE && b.length > 44;
    const fresh = ok && Buffer.compare(b, wav(RECIPES[cue]())) === 0;
    console.log(`${ok ? (fresh ? "  ok  " : "STALE ") : "FAIL  "} ${cue}.wav (${b.length} bytes)`);
    if (!ok || !fresh) problems++;
  }
  process.exit(problems ? 1 : 0);
}

mkdirSync(OUT, { recursive: true });
for (const cue of CUES) {
  const buf = wav(RECIPES[cue]());
  writeFileSync(join(OUT, `${cue}.wav`), buf);
  console.log(`wrote assets/combat-intro/etched/${cue}.wav (${buf.length} bytes)`);
}
