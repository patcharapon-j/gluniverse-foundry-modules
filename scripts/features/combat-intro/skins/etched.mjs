/**
 * Combat Intro skin — "Etched × Endfield", the default.
 *
 * The suite's Etched Glass as the material and an industrial survey HUD as
 * the drafting layer over it: a measured grid that draws itself in from the
 * centre, corner brackets and tick rules, a scan line, light columns behind
 * each side of the roster, a title struck between two rules with an
 * anamorphic flash, a hazard band whose chevrons take the threat's colour,
 * then a calm field with a pool of light under every die and a ring when one
 * lands, streaks while the cards sort, and a closing line that sweeps the
 * whole stage up into the rail.
 *
 * Budget: one pass, no texture reads, one loop over the anchors only while the
 * roll table is up. Every idle term turns a whole number of times in the 64 s
 * loop (etPh / the band scroll), so nothing steps when uTime wraps; every
 * hairline is sized in device pixels through uDpr, so it is one physical
 * pixel on any display and never sub-pixel on an ordinary one.
 *
 * Pure: a skin module is data plus one function (docs/COMBAT_INTRO.md).
 */
import { CUES } from "../constants.mjs";

export const SHED_ORDER = Object.freeze(["rings", "grid", "streaks"]);

const uniforms = Object.freeze([
  { name: "uDpr", type: "float" },
  { name: "uBoot", type: "float" },
  { name: "uSweep", type: "float" },
  { name: "uRoster", type: "float" },
  { name: "uRule", type: "float" },
  { name: "uFlash", type: "float" },
  { name: "uThreat", type: "float" },
  { name: "uSevK", type: "float" },
  { name: "uTable", type: "float" },
  { name: "uAnchorFx", type: "vec4", count: 12 },
  { name: "uSort", type: "float" },
  { name: "uMove", type: "float" },
  { name: "uCollapse", type: "float" },
  { name: "uGrid", type: "float" },
  { name: "uRings", type: "float" },
]);

const fragment = /* glsl */ `
const float ET_TAU = 6.28318530718;
/* k whole turns per 64 s loop: continuous across the uTime wrap. */
float etPh(float k) { return uTime * ET_TAU * k / 64.0; }
float etHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/* A line of width w device pixels at signed distance d, one pixel of AA. */
float etLine(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + uDpr, abs(d)); }
float etLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);   /* device px, origin top-left like the DOM */
  vec2 c = uRes * 0.5;
  vec2 q = (p - c) / uRes.y;
  float hair = max(1.0, uDpr);
  float vig = smoothstep(1.3, 0.2, length(q * vec2(0.85, 1.15)));
  vec3 cool = mix(uAccent, uHot, 0.35);

  /* ── the field: an ink veil, lifted toward the centre ─────────────── */
  float veil = mix(0.9, 0.74, vig) * mix(1.0, 0.86, step(0.5, uPhase) * (1.0 - step(2.5, uPhase)));
  vec3 base = uInk + uAccent * (0.045 * vig + 0.02 * sin(q.y * 6.0 + etPh(2.0)) * vig);
  vec3 glow = vec3(0.0);

  /* ── survey grid, drawn in radially from the centre at boot ───────── */
  float cell = 56.0 * uDpr;
  vec2 g = p - c;
  vec2 gM = abs(mod(g + cell * 2.0, cell * 4.0) - cell * 2.0);
  float reveal = smoothstep(uBoot * 1.35, uBoot * 1.35 - 0.18, length(q));
  float shimmer = 0.75 + 0.25 * sin(etPh(3.0) + q.x * 4.0 - q.y * 3.0);
  float gridK = 0.075 * max(etLine(gM.x, hair), etLine(gM.y, hair));
  if (uGrid > 0.5) {
    vec2 gm = abs(mod(g + cell * 0.5, cell) - cell * 0.5);
    gridK += 0.035 * max(etLine(gm.x, hair), etLine(gm.y, hair));
    /* crosshair ticks on the major intersections */
    float arm = 7.0 * uDpr;
    gridK += 0.42 * max(step(gM.x, arm) * etLine(gM.y, hair), step(gM.y, arm) * etLine(gM.x, hair));
  }
  glow += uAccent * gridK * reveal * vig * shimmer * (1.0 - 0.6 * uTable);

  /* ── HUD frame: corner brackets and a tick rule along the top ─────── */
  vec2 dc = min(p, uRes - p);
  float m = 34.0 * uDpr, L = 120.0 * uDpr * uBoot;
  float bx = etLine(dc.x - m, hair * 1.5) * step(dc.y - m, L) * step(-hair, dc.y - m);
  float by = etLine(dc.y - m, hair * 1.5) * step(dc.x - m, L) * step(-hair, dc.x - m);
  float edgeRule = max(etLine(dc.x - m, hair), etLine(dc.y - m, hair)) * step(m - hair, min(dc.x, dc.y));
  float tx = abs(mod(p.x - c.x + 12.0 * uDpr, 24.0 * uDpr) - 12.0 * uDpr);
  float ticks = etLine(tx, hair) * step(m + 5.0 * uDpr, p.y) * step(p.y, m + 11.0 * uDpr)
              * step(abs(p.x - c.x), uRes.x * 0.3 * uBoot);
  glow += cool * (max(bx, by) * 0.85 + edgeRule * 0.07 * uBoot + ticks * 0.35);

  /* ── the scan line (boot, and the deal) ───────────────────────────── */
  if (uSweep >= 0.0) {
    float d = p.y - uSweep * uRes.y;
    float trail = exp(d / (110.0 * uDpr)) * step(d, 0.0);
    glow += cool * (etLine(d, hair * 1.5) * 0.85 + trail * 0.09);
  }

  /* ── roster: a light column behind each side ──────────────────────── */
  if (uRoster > 0.001) {
    float w = uRes.x * 0.085;
    float floorK = 0.35 + 0.65 * smoothstep(0.05, 1.0, p.y / uRes.y);
    float slats = 0.8 + 0.2 * step(0.5, fract(p.y / (4.0 * uDpr)));
    float colL = exp(-pow((p.x - uRes.x * 0.27) / w, 2.0));
    float colR = exp(-pow((p.x - uRes.x * 0.73) / w, 2.0));
    vec3 hostile = mix(uAccent, uWarn, 0.85);
    glow += (uAccent * colL + hostile * colR) * 0.16 * floorK * slats * uRoster;
    /* a rising mote line in each column, whole turns per loop */
    float rise = fract(-p.y / uRes.y + uTime * 4.0 / 64.0);
    glow += (uAccent * colL + hostile * colR) * smoothstep(0.985, 1.0, rise) * 0.25 * uRoster;
  }

  /* ── title: two rules grow from the centre, an anamorphic strike ──── */
  if (uRule > 0.001 || uFlash > 0.001) {
    float ty = uRes.y * 0.40;
    float span = uRule * uRes.x * 0.42;
    float inSpan = step(abs(p.x - c.x), span);
    float rules = (etLine(p.y - (ty - uRes.y * 0.085), hair) + etLine(p.y - (ty + uRes.y * 0.075), hair)) * inSpan;
    float caps = step(abs(abs(p.x - c.x) - span), 3.0 * uDpr) * step(abs(abs(p.y - ty) - uRes.y * 0.08), 6.0 * uDpr) * step(0.02, uRule);
    glow += cool * (rules * 0.8 + caps * 0.9);
    float streak = exp(-abs(p.y - ty) / (5.0 * uDpr)) * exp(-abs(p.x - c.x) / (uRes.x * 0.32));
    glow += mix(uHot, vec3(1.0), 0.3) * streak * uFlash * 1.4 + uAccent * uFlash * 0.08 * vig;
  }

  /* ── threat: a hazard band, chevrons in the severity's colour ─────── */
  if (uThreat > 0.001) {
    float by0 = uRes.y * 0.835, bh = 30.0 * uDpr;
    float half_ = uRes.x * 0.5 * uThreat;
    float inBand = step(abs(p.y - by0), bh * 0.5) * step(abs(p.x - c.x), half_);
    float P = 22.0 * uDpr;
    float scroll = fract(uTime * 48.0 / 64.0) * P;              /* 48 periods per loop */
    float stripe = step(0.5, fract((p.x + (p.y - by0) + scroll) / P));
    vec3 sev = mix(uAccent, uWarn, uSevK);
    glow += sev * inBand * (0.10 + 0.22 * stripe);
    float edges = (etLine(p.y - (by0 - bh * 0.5), hair) + etLine(p.y - (by0 + bh * 0.5), hair)) * step(abs(p.x - c.x), half_ + 40.0 * uDpr);
    glow += sev * edges * 0.7;
  }

  /* ── the roll table: a pool under every die, a ring when one lands ── */
  if (uTable > 0.001) {
    glow += uAccent * 0.05 * smoothstep(0.35, 1.0, p.y / uRes.y) * uTable;
    for (int i = 0; i < ${12}; i++) {
      if (float(i) >= uAnchorN) break;
      vec4 A = uAnchors[i];
      vec2 d = p - A.xy;
      float r = max(8.0, A.z);
      float dd = dot(d, d) / (r * r);
      float lt = uAnchorFx[i].y;
      bool ring = uRings > 0.5 && lt >= 0.0 && lt < 1.4;
      if (dd > 9.0 && !(ring && dd < 12.0)) continue;   /* outside every term: exp(-14) is black */
      float lvl = A.w < 0.5 ? 0.16 : (A.w < 1.5 ? 0.45 : 0.3);
      glow += uAccent * exp(-dd * 1.6) * lvl * uTable;
      if (ring) {
        float rr = r * (0.55 + lt * 1.7);
        glow += cool * etLine(length(d) - rr, hair * 2.0) * exp(-lt * 2.6) * 1.1 * uTable;
        glow += uHot * exp(-dd * 3.0) * exp(-lt * 5.0) * 0.55 * uTable;
      }
    }
  }

  /* ── the sort: streaks along the travel ───────────────────────────── */
  if (uSort > 0.001) {
    float row = floor(p.y / (3.0 * uDpr));
    float h = etHash(vec2(row, 7.0));
    float lane = step(0.86, h) * smoothstep(0.24, 0.36, p.y / uRes.y) * smoothstep(0.76, 0.64, p.y / uRes.y);
    float seg = fract(p.x / uRes.x * 1.3 + h * 7.0 - uMove * (1.2 + h));
    float streak = smoothstep(0.0, 0.03, seg) * smoothstep(0.32, 0.0, seg) * lane;
    glow += cool * streak * uSort * 0.6;
  }

  /* ── handoff: a closing line sweeps the stage up into the rail ────── */
  if (uCollapse > 0.0) {
    float k = uCollapse * uCollapse * (3.0 - 2.0 * uCollapse);
    float yc = mix(uRes.y * 1.02, -4.0 * uDpr, k);
    float keep = smoothstep(yc + 2.0 * uDpr, yc - 36.0 * uDpr, p.y);
    veil *= keep;
    glow *= keep;
    glow += cool * etLine(p.y - yc, hair * 2.0) * (1.0 - 0.5 * k) + cool * exp(-max(0.0, yc - p.y) / (40.0 * uDpr)) * keep * 0.12;
  }

  float dither = (etHash(p + fract(uTime)) - 0.5) / 255.0;
  float a = clamp(veil + etLuma(glow), 0.0, 1.0) * uIntensity;
  outColor = vec4((base * veil + glow) * uIntensity + dither, a);
}
`;

/**
 * Write this skin's uniforms. `f` is the director's frame record: the
 * contract's { phase, beat, beatT, phaseT, time, anchors, allows, palette }
 * plus { dpr, curves, severity, anchorFx }.
 */
function write(u, f) {
  const c = f.curves ?? {};
  u.uDpr = f.dpr ?? 1;
  u.uBoot = c.boot ?? 1;
  u.uSweep = c.sweep ?? -1;
  u.uRoster = c.roster ?? 0;
  u.uRule = c.title ?? 0;
  u.uFlash = c.flash ?? 0;
  u.uThreat = c.threat ?? 0;
  u.uSevK = f.severity == null || f.severity < 0 ? 0 : f.severity / 4;
  u.uTable = c.table ?? 0;
  u.uAnchorFx = f.anchorFx ?? new Float32Array(48).fill(-1);
  u.uSort = f.allows("streaks") ? (c.streak ?? 0) : 0;
  u.uMove = c.move ?? 0;
  u.uCollapse = c.collapse ?? 0;
  u.uGrid = f.allows("grid") ? 1 : 0;
  u.uRings = f.allows("rings") ? 1 : 0;
}

const sounds = Object.freeze(Object.fromEntries(CUES.map((cue) => [cue, `assets/combat-intro/etched/${cue}.wav`])));

export default { id: "etched", fragment, uniforms, write, SHED_ORDER, sounds };
