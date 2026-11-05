/**
 * GLUniverse Suite — Timer feature: the pure view.
 *
 * Everything the HUD decides about what to draw, with no `game`, no DOM and no
 * clock: the digits, the tier, the tone, the tag, the drain and the markup.
 * `hud.mjs` reads the world and the frame clock and asks this module; the check
 * (`tools/timer-check.mjs`) and the preview (`tools/timer-preview.mjs`) drive
 * it as shipped.
 */

import { URGENT_MS, CRITICAL_MS } from "./state.mjs";
import { escapeHTML } from "../../core/util.mjs";

/** Lengths of the decorative beats (ms, before the motion tier scales them).
 *  The same moments Stream Pacer plays on its countdown lane. */
export const TIMER_MOTION = Object.freeze({
  wipe: 420,     // the plate arrives as one hard wipe, left to right
  tagIn: 540,    // the tag slides in behind the wipe
  sweep: 900,    // the light that crosses the plate on arrival and on a flare
  flare: 420,    // a tier change: the plate swells once
  knock: 280,    // the clock's knock, once a second in its last ten
  hit: 480,      // time up: the plate takes the hit
});

/**
 * How often the hundredths are redrawn in the last minute (ms). Thirty times
 * a second is past what anyone reads off a running SS.cc, and each redraw is a
 * text layout: drawing them on every frame of a 144 Hz screen is five times
 * the work for no visible difference.
 */
export const FINE_TICK_MS = 33;

/** Seconds at the end during which the clock knocks (and the tick sounds). */
export const KNOCK_MS = CRITICAL_MS;

/** Split a remaining-ms into the large main field and the small fractional tail. */
export function formatParts(remMs) {
  const rem = Math.max(0, Number(remMs) || 0);
  if (rem >= URGENT_MS) {
    const total = Math.ceil(rem / 1000); // linger on the round value
    const m = Math.floor(total / 60);
    const s = total % 60;
    return { main: `${m}:${String(s).padStart(2, "0")}`, frac: "" };
  }
  const s = Math.floor(rem / 1000);
  const cc = Math.floor((rem % 1000) / 10);
  return { main: String(s).padStart(2, "0"), frac: `.${String(cc).padStart(2, "0")}` };
}

/** calm (over a minute), urgent (the last minute), critical (the last ten), expired. */
export function tierOf(remMs, expired) {
  if (expired || remMs <= 0) return "expired";
  if (remMs >= URGENT_MS) return "calm";
  if (remMs > CRITICAL_MS) return "urgent";
  return "critical";
}

/**
 * The one tone the plate carries (DESIGN.md, the One Tone Rule). Paper while
 * there is time, amber in the last minute, red in the last ten and at zero,
 * steel while held. A held timer is steel whatever it holds: the hue says
 * "this is not moving", which is the thing the table needs to read.
 */
export function toneOf(tier, paused) {
  if (tier === "expired") return "red";
  if (paused) return "steel";
  if (tier === "critical") return "red";
  if (tier === "urgent") return "amber";
  return "paper";
}

/** The tag's word: what the number is doing. */
export function tagKeyOf(tier, paused) {
  if (tier === "expired") return "GLTIMER.hud.up";
  if (paused) return "GLTIMER.hud.paused";
  return "GLTIMER.hud.timer";
}

/** The tag's icon, one per tag word. */
export function tagIconOf(tier, paused) {
  if (tier === "expired") return "fa-solid fa-bell";
  if (paused) return "fa-solid fa-pause";
  return "fa-solid fa-stopwatch";
}

/**
 * The drain, as one full-to-empty keyframe: its whole length (ms) and how far
 * into it the bar already is. The CSS enters it part-way with a negative
 * delay, so the keyframe stays fixed and runs on the compositor. Time added
 * past the original length fills the bar rather than overflowing it; at zero
 * the length is zero and the bar sits empty.
 */
export function drainOf(remMs, totalMs) {
  const rem = Math.max(0, Math.round(Number(remMs) || 0));
  if (!rem) return { total: 0, elapsed: 0 };
  const total = Math.max(rem, Math.round(Number(totalMs) || 0));
  return { total, elapsed: total - rem };
}

/** The whole second a knock lands on, or null outside the last ten. */
export function knockSecondOf(remMs) {
  if (!(remMs > 0) || remMs > KNOCK_MS) return null;
  return Math.ceil(remMs / 1000);
}

/** The GM's live controls, in strip order. */
export const STRIP = Object.freeze([
  { act: "pause", icon: "fa-solid fa-pause", key: "GLTIMER.strip.pause", group: "run" },
  { act: "sub60", label: "−1:00", ms: -60_000, key: "GLTIMER.strip.sub", group: "adjust" },
  { act: "sub10", label: "−0:10", ms: -10_000, key: "GLTIMER.strip.sub", group: "adjust" },
  { act: "add10", label: "+0:10", ms: 10_000, key: "GLTIMER.strip.add", group: "adjust" },
  { act: "add60", label: "+1:00", ms: 60_000, key: "GLTIMER.strip.add", group: "adjust" },
  { act: "edit", icon: "fa-solid fa-pen", key: "GLTIMER.strip.edit", group: "end" },
  { act: "stop", icon: "fa-solid fa-xmark", key: "GLTIMER.strip.stop", group: "end" },
]);

/** Every key this view localizes, for the check. */
export const VIEW_KEYS = Object.freeze([
  "GLTIMER.hud.timer", "GLTIMER.hud.paused", "GLTIMER.hud.up", "GLTIMER.hud.region",
  "GLTIMER.strip.label", "GLTIMER.strip.resume",
  ...new Set(STRIP.map((b) => b.key)),
]);

const esc = escapeHTML;

function stripButton(b, L) {
  const label = esc(L(b.key));
  const body = b.icon ? `<i class="${b.icon}" aria-hidden="true"></i>` : esc(b.label);
  const cls = ["gltimer-ctl", `gltimer-${b.act}`, b.icon ? "is-icon" : "is-time"].join(" ");
  return `<button type="button" class="${cls}" data-act="${b.act}" title="${label}" aria-label="${label}">${body}</button>`;
}

/** The GM strip: run, the four adjusters as one group, then edit and stop. */
export function stripHTML(L) {
  const group = (g) => STRIP.filter((b) => b.group === g).map((b) => stripButton(b, L)).join("");
  return `<div class="gltimer-strip" role="toolbar" aria-label="${esc(L("GLTIMER.strip.label"))}">`
    + `<div class="gltimer-strip-group is-run">${group("run")}</div>`
    + `<div class="gltimer-strip-group is-adjust">${group("adjust")}</div>`
    + `<div class="gltimer-strip-group is-end">${group("end")}</div>`
    + `</div>`;
}

/** The HUD's inner markup. The root element is the HUD's own. */
export function hudHTML(L, { gm = false } = {}) {
  return `<div class="gltimer-plate">`
    + `<span class="gltimer-drain" aria-hidden="true"><i></i></span>`
    + `<span class="gltimer-tag"><i class="gltimer-tag-icon fa-solid fa-stopwatch" aria-hidden="true"></i>`
    + `<span class="gltimer-tag-text">${esc(L("GLTIMER.hud.timer"))}</span></span>`
    + `<div class="gltimer-face" role="timer" aria-label="${esc(L("GLTIMER.hud.region"))}">`
    + `<span class="gltimer-main">0:00</span><span class="gltimer-frac"></span></div>`
    + `<span class="gltimer-sheen" aria-hidden="true"><span class="gltimer-sheen-light"></span></span>`
    + `<span class="gltimer-impact" aria-hidden="true"></span>`
    + `</div>`
    + (gm ? stripHTML(L) : "");
}
