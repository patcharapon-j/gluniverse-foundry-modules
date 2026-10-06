/**
 * Combat Intro — the "Aegis Fallen" skin.
 *
 * The user's post-apocalyptic dieselpunk PF2e campaign, in the language of its
 * audience app: a red halftone printed over the void and seen through a monitor.
 * This module is the WebGL half (see aegis-glsl.mjs); the DOM half is
 * styles/combat-intro-aegis.css, scoped to `.glci[data-skin="aegis"]`.
 *
 * Choreography on the shared beats (timeline.mjs owns WHEN, this owns HOW):
 *   intro.boot    the furnace field ignites, one hard boot scan runs down the screen
 *   intro.roster  the signal lock: snow on a misregistered screen resolving into the
 *                 hex survey; contacts ping on the roster portraits (uAnchors)
 *   intro.title   shockwave ring, misprint pulse, halftone blast off the title line
 *   intro.threat  the lock arcs close; amber hazard scaled by the threat severity
 *   intro.out     breach: focus scan, glitch tear, burning paper edge, cut to void
 *   rolling       a low furnace, embers, a halftone pool under each die, a flare on landing
 *   sorting       torn signal bands streak along each card's travel
 *   handoff       collapse to a horizon line, then the cut to the void
 *
 * Pure: no `game`, no DOM. Imported under plain Node by the check tool and preview.
 */

import { FRAGMENT_GLSL } from "./aegis-glsl.mjs";
import { INTRO, SORT, HANDOFF } from "../timeline.mjs";

/** Shed in this order under load, most expensive first. */
export const SHED_ORDER = Object.freeze(["misprint", "second-screen", "smoke-octaves", "embers"]);

export const uniforms = Object.freeze([
  { name: "uField", type: "vec4" },
  { name: "uLink", type: "vec4" },
  { name: "uEvent", type: "vec4" },
  { name: "uBreach", type: "vec4" },
  { name: "uSort", type: "vec4" },
  { name: "uFlare0", type: "vec4" },
  { name: "uFlare1", type: "vec4" },
  { name: "uFlare2", type: "vec4" },
  { name: "uShedMask", type: "vec4" },
]);

/** One file per cue (constants.mjs CUES), relative to the module root. Source: README.txt beside them. */
export const sounds = Object.freeze({
  introHit: "assets/combat-intro/aegis/impact.webm",
  rosterTick: "assets/combat-intro/aegis/lock-on.webm",
  titleSlam: "assets/combat-intro/aegis/slam.webm",
  throw: "assets/combat-intro/aegis/swish.webm",
  dieLand: "assets/combat-intro/aegis/die.webm",
  seal: "assets/combat-intro/aegis/stamp.webm",
  sortTick: "assets/combat-intro/aegis/ratchet.webm",
  dockIn: "assets/combat-intro/aegis/hydraulic.webm",
});

const PHASE_INDEX = { intro: 0, rolling: 1, sorting: 2, handoff: 3 };
const BEATS = { 0: INTRO, 2: SORT, 3: HANDOFF };

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Smoothstep, as the shader spells it. */
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A one-shot pulse struck at `at`, decaying with time constant `k` (both in beat-t units). */
const strike = (t, at, k) => (t < at ? 0 : Math.exp(-(t - at) / k));

/** Threat severity (0..4, -1 none) to the amber hazard level. */
const WARN_BY_SEVERITY = [0.2, 0.35, 0.6, 0.85, 1];

function phaseIndex(phase) {
  if (typeof phase === "number") return phase;
  return PHASE_INDEX[phase] ?? 1;
}

/** The beat name, from f.beatName, a string beat or an index into the phase's beat list. */
function beatName(f, p) {
  if (typeof f.beatName === "string" && f.beatName) return f.beatName;
  if (typeof f.beat === "string") return f.beat;
  const list = BEATS[p];
  return list?.[Math.max(0, Math.min(list.length - 1, Math.round(Number(f.beat) || 0)))]?.[0] ?? "";
}

/**
 * Seconds since each anchor's die landed, or -1. Reads f.anchorFx (Float32Array(48),
 * y = seconds since land) when the runtime supplies it; otherwise no flares.
 */
function landAge(f, i) {
  const fx = f.anchorFx;
  if (!fx || fx.length < i * 4 + 2) return -1;
  const y = Number(fx[i * 4 + 1]);
  return Number.isFinite(y) ? y : -1;
}

/** A landing flare: struck on the land, gone in ~0.7 s. */
const flare = (age) => (age < 0 ? 0 : Math.exp(-age / 0.22) * (age < 1.2 ? 1 : 0));

/** Every beat's parameters. Returns the nine vec4s. */
export function params(f) {
  const p = phaseIndex(f.phase);
  const beat = beatName(f, p);
  const t = clamp01(Number(f.beatT) || 0);
  const sev = Number.isInteger(f.severity) && f.severity >= 0 ? WARN_BY_SEVERITY[Math.min(4, f.severity)] : 0.6;

  const field = [0.6, 0.25, 0, 0];
  const link = [0, 0, 0, 0];
  const event = [0, 0, 0, 0];
  const brk = [0, 0, 0, 0];
  const sort = [0, 0, 0, 0];

  if (p === 0) {
    if (beat === "boot") {
      field[0] = ss(0, 0.7, t) * 0.9;
      field[1] = 0.15 + 0.35 * t;
      field[2] = 1 - ss(0, 0.3, t);
      field[3] = Math.max(t, 0.002);
    } else if (beat === "roster") {
      field[0] = 0.55;
      link[0] = ss(0, 0.45, t);
      link[1] = ss(0.08, 0.92, t);
      link[2] = t * 2;
      link[3] = Math.max(strike(t, 0.34, 0.05), strike(t, 0.62, 0.05), strike(t, 0.9, 0.04)) * 0.9;
    } else if (beat === "title") {
      field[0] = 0.5;
      link[0] = 1 - 0.35 * ss(0.2, 0.9, t);
      link[1] = 1;
      link[2] = 2 + t;
      link[3] = strike(t, 0, 0.12);
      event[0] = ss(0, 0.75, t);
      event[2] = Math.pow(ss(0.02, 1, t), 0.8);
    } else if (beat === "threat") {
      field[0] = 0.5;
      field[2] = 0.3 * sev;
      link[0] = 0.65;
      link[1] = 1;
      link[2] = 3 + t * 0.8;
      link[3] = strike(t, 0.55, 0.08) * 0.5 * sev;
      event[3] = sev * ss(0, 0.2, t);
      sort[2] = ss(0, 0.6, t);
    } else if (beat === "out") {
      field[0] = 0.5 * (1 - ss(0.3, 0.9, t));
      link[0] = 0.65 * (1 - ss(0.3, 0.85, t));
      link[1] = 1;
      link[2] = 3.8 + t * 0.5;
      event[3] = sev * (1 - ss(0, 0.4, t));
      sort[2] = 1;
      brk[0] = ss(0, 0.3, t);
      brk[1] = ss(0.1, 0.35, t) * (1 - ss(0.7, 0.92, t));
      brk[2] = ss(0.3, 0.94, t);
      brk[3] = ss(0.9, 1, t);
    }
  } else if (p === 1) {
    field[0] = 0.55;
    field[1] = 0.2;
    sort[3] = 1;
  } else if (p === 2) {
    field[0] = 0.5;
    sort[3] = beat === "hold" ? 1 : beat === "move" ? 1 - ss(0, 0.4, t) : 0;
    sort[0] = beat === "move" ? Math.sin(Math.PI * t) : beat === "settle" ? (1 - t) * 0.15 : 0;
  } else if (p === 3) {
    if (beat === "collapse") {
      field[0] = 0.5;
      event[1] = ss(0, 1, t);
      sort[1] = ss(0.35, 1, t);
    } else {
      field[0] = 0.5 * (1 - t);
      event[1] = 1;
      sort[1] = 1 - ss(0.15, 0.8, t);
    }
  }

  const fl = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (p === 1) for (let i = 0; i < 12; i++) fl[i] = flare(landAge(f, i));

  const allows = typeof f.allows === "function" ? f.allows : () => true;
  const shed = SHED_ORDER.map((n) => (allows(n) ? 1 : 0));

  return {
    uField: field,
    uLink: link,
    uEvent: event,
    uBreach: brk,
    uSort: sort,
    uFlare0: fl.slice(0, 4),
    uFlare1: fl.slice(4, 8),
    uFlare2: fl.slice(8, 12),
    uShedMask: shed,
  };
}

/** Write every declared uniform onto `u` (a plain object the backdrop uploads). */
export function write(u, f) {
  const v = params(f ?? {});
  for (const { name } of uniforms) u[name] = v[name];
  return u;
}

export const fragment = FRAGMENT_GLSL;

export default Object.freeze({ id: "aegis", fragment, uniforms, write, SHED_ORDER, sounds });
