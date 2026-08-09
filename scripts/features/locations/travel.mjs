/**
 * GLUniverse Suite — Locations: the curtain, the card, and the trip itself.
 *
 * ## The one-phase model
 *
 * The curtain mounts a **plate** — a still of the outgoing backdrop — over the
 * live canvas. Because it is identical to what the canvas is already showing,
 * mounting is invisible. The document write then happens *behind* the plate, so
 * Foundry's hard canvas redraw, the camera fit and Stage's relight all land
 * unseen. Only then does the transition run, and every transition is one thing:
 * **a way of destroying the plate** to reveal the canvas that is already correct
 * underneath.
 *
 * That collapses cover/hold/lift into a single animation per style, which is
 * what lets a style be a table row instead of a timeline. Even a fade to black
 * fits: the veil rides 0 → 1 → 0 while the plate cuts at the midpoint, so the
 * audience sees old → black → new with the seam hidden inside the black.
 *
 * ## Where the timing lives
 *
 * Durations are `--gl-d-*` tokens in `styles/locations.css`; the `ms` column
 * below mirrors the token's scale-1 value so `scaledMs()` can keep the JS
 * teardown locked to the CSS. Both are then scaled by one scoped
 * `--gl-motion-scale` on the curtain root, which is the client's motion tier
 * times the world's pace multiplier. A tier of `off` is 0×, which makes every
 * style a hard cut for free — no branch in here does that.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { MOTION_SCALE, scaledMs } from "../../core/theme.mjs";
import { clampNumber, escapeAttr, hex6 } from "../../core/util.mjs";
import {
  FEATURE_ID, SETTING_MOTION, SETTING_PACE, SETTING_RECENTER, SETTING_SETTLE,
  findEntry, getHome, markTravelled, readBackground, writeBackground,
} from "./deck.mjs";

/* ══════════════════════════════════════════════════════════════════════
   The catalogue
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Every preset. Twenty-one rows over seven mechanisms: `mech` picks the CSS
 * machinery, the style id selects its parameters within that machinery, and
 * adding a twenty-second preset is a row here plus a rule in the stylesheet.
 *
 * `ms` mirrors the `--gl-d-*` token the stylesheet uses for that style at
 * scale 1 — if you retime a style in CSS, retime it here too or the curtain will
 * unmount early. `group` drives the grouped <select> in the panel.
 *
 * Note `fade`, `bleach` and `flash` share one mechanism. Colour codes the event
 * (black ends a chapter, white is arrival) and *duration codes the tone*: white
 * at 1200ms is transcendence, the same white at 70ms is a blow landing.
 */
export const STYLES = {
  cut:             { group: "plain",      mech: "none",   ms: 0 },
  fade:            { group: "plain",      mech: "field",  ms: 720 },
  bleach:          { group: "plain",      mech: "field",  ms: 1200 },
  dissolve:        { group: "plain",      mech: "plate",  ms: 540 },

  push:            { group: "optical",    mech: "xform",  ms: 420 },
  defocus:         { group: "optical",    mech: "xform",  ms: 720 },
  ripple:          { group: "optical",    mech: "ripple", ms: 920 },

  wipe:            { group: "graphic",    mech: "mask",   ms: 420 },
  iris:            { group: "graphic",    mech: "mask",   ms: 540 },
  clock:           { group: "graphic",    mech: "mask",   ms: 920 },
  shutter:         { group: "graphic",    mech: "mask",   ms: 420 },
  shoji:           { group: "graphic",    mech: "mask",   ms: 540 },

  "ink-bleed":     { group: "material",   mech: "ink",    ms: 920 },
  "ink-brush":     { group: "material",   mech: "ink",    ms: 540 },
  "noise-dissolve":{ group: "material",   mech: "shred",  ms: 720 },
  "paper-tear":    { group: "material",   mech: "shred",  ms: 540 },
  "film-burn":     { group: "material",   mech: "shred",  ms: 720 },

  flash:           { group: "aggressive", mech: "field",  ms: 70 },
  slash:           { group: "aggressive", mech: "mask",   ms: 340 },
  whip:            { group: "aggressive", mech: "xform",  ms: 260 },
  glitch:          { group: "aggressive", mech: "rgb",    ms: 340 },
};

export const STYLE_GROUPS = ["plain", "optical", "graphic", "material", "aggressive"];

export const DEFAULT_STYLE = "fade";

/** Styles whose whole point is disorientation — demoted at the `reduced` tier. */
const DEMOTED_WHEN_REDUCED = new Set(["glitch", "whip", "ripple", "flash"]);

/** Never hold the screen longer than this waiting for a redraw that may never come. */
const REDRAW_CAP_MS = 4000;

/**
 * Default grace after the canvas redraw before the plate comes off, covering
 * Stage's 620ms relight tween so the cast is already lit when the reveal starts.
 *
 * Exposed as `loc.settle` because it is a taste call, not a tuning constant.
 * Hades runs a 1–4s colour-grade ramp that outlasts its room wipe on purpose,
 * and the room arriving still warming up *is* the effect; Stage's relight is
 * structurally the same thing. At 0 the cast re-lights in the open as the reveal
 * completes, at 700 it is simply correct by the time you see it, and which reads
 * better depends on the art and the table.
 */
const SETTLE_DEFAULT_MS = 700;
const SETTLE_MAX_MS = 1500;

/** Name card: fades in this far into the reveal, then holds. */
const CARD_LEAD = 0.5;
const CARD_HOLD_MS = 2500;
const CARD_FADE_MS = 340;

const VIDEO_RE = /\.(webm|mp4|m4v|ogv|ogg)$/i;

/* ══════════════════════════════════════════════════════════════════════
   Client-side settings
   ══════════════════════════════════════════════════════════════════════ */

function readSetting(key, fallback) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}

/** Client motion tier × world pace, as one `--gl-motion-scale` value. */
function motionFor(style) {
  const tier = String(readSetting(SETTING_MOTION, "full"));
  const pace = clampNumber(readSetting(SETTING_PACE, 1), 0.5, 2, 1);
  const tierScale = MOTION_SCALE[tier] ?? MOTION_SCALE.default;
  const resolved = tier === "reduced" && DEMOTED_WHEN_REDUCED.has(style) ? DEFAULT_STYLE : style;
  return { style: resolved, scale: tierScale * pace };
}

/* ══════════════════════════════════════════════════════════════════════
   Shared SVG filter defs
   ══════════════════════════════════════════════════════════════════════ */

const DEFS_ID = "gl-loc-defs";

/**
 * One inline SVG for the whole feature. Filter primitive attributes are not
 * CSS-animatable and do not read custom properties, so every filter here is
 * static — the animation always lives in the CSS gradient underneath it. The
 * lone exception is `#gl-loc-ripple`, driven by SMIL from {@link playRipple}.
 */
function ensureDefs() {
  if (document.getElementById(DEFS_ID)) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = DEFS_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <defs>
      <!-- Ink flood. Blur turns the mask's hard edge into an alpha ramp;
           displacement pushes that ramp around the noise, which is where the
           lobes and tendrils come from; the alpha matrix snaps it back to a
           crisp ink edge. That last multiplier is Ren'Py's ramplen: raise it
           for a dry cut-paper edge, lower it for a wet spreading one.
           Anisotropic baseFrequency gives the blot a paper-fibre grain. -->
      <filter id="gl-loc-ink" x="-30%" y="-30%" width="160%" height="160%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.014 0.018" numOctaves="4" seed="7" result="n"/>
        <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b"/>
        <feDisplacementMap in="b" in2="n" scale="80" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feColorMatrix in="d" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -12"/>
      </filter>

      <!-- Threshold dissolve. feComposite/in multiplies the plate by the
           noise matte's alpha; the plate's own opacity ramp (on the inner
           element, so it is inside this filter's input) then walks the product
           down through the alpha threshold. Result: a noise-shaped edge
           advancing across the frame from a plain opacity fade.

           Not "arithmetic": feComposite works on PREMULTIPLIED colour and
           applies k1·i1·i2 to the RGB channels too, so compositing against a
           matte whose RGB is zero renders the plate solid black while the alpha
           maths looks perfectly correct. "in" scales by alpha alone. -->
      <filter id="gl-loc-shred" x="0%" y="0%" width="100%" height="100%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="4" seed="3" result="n"/>
        <feColorMatrix in="n" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.34 0.34 0.34 0 0" result="na"/>
        <feComposite in="SourceGraphic" in2="na" operator="in" result="m"/>
        <feColorMatrix in="m" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/>
      </filter>

      <!-- Paper tear: the same trick with long horizontal fibres and a harder
           threshold, which is the difference between disintegrating and being
           torn along a grain. -->
      <filter id="gl-loc-tear" x="0%" y="0%" width="100%" height="100%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.004 0.05" numOctaves="3" seed="11" result="n"/>
        <feColorMatrix in="n" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.34 0.34 0.34 0 0" result="na"/>
        <feComposite in="SourceGraphic" in2="na" operator="in" result="m"/>
        <feColorMatrix in="m" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -28"/>
      </filter>

      <!-- Film burn: coarse cellular noise, soft threshold, so the frame eats
           itself in blooming patches rather than crumbling. -->
      <filter id="gl-loc-burn" x="0%" y="0%" width="100%" height="100%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="5" result="n"/>
        <feColorMatrix in="n" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.34 0.34 0.34 0 0" result="na"/>
        <feComposite in="SourceGraphic" in2="na" operator="in" result="m"/>
        <feColorMatrix in="m" type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -5"/>
      </filter>

      <!-- Chromatic split: red and blue torn apart and screened back together
           over the untouched green, which is what a broken signal looks like. -->
      <filter id="gl-loc-rgb" x="-10%" y="-10%" width="120%" height="120%"
              color-interpolation-filters="sRGB">
        <feOffset in="SourceGraphic" dx="-9" dy="0" result="ro"/>
        <feColorMatrix in="ro" type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
        <feOffset in="SourceGraphic" dx="9" dy="0" result="bo"/>
        <feColorMatrix in="bo" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
        <feBlend in="r" in2="g" mode="screen" result="rg"/>
        <feBlend in="rg" in2="b" mode="screen"/>
      </filter>

      <!-- Ripple: the only animated filter in the feature. SMIL, because
           feDisplacementMap/@scale is not reachable from CSS at all. -->
      <filter id="gl-loc-ripple" x="-10%" y="-10%" width="120%" height="120%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="13" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0"
                           xChannelSelector="R" yChannelSelector="G">
          <animate attributeName="scale" values="0;70;0" dur="0.92s" begin="indefinite" fill="freeze"/>
        </feDisplacementMap>
      </filter>
    </defs>`;
  document.body.appendChild(svg);
}

/** Kick the one SMIL animation, retimed to the resolved duration. */
function playRipple(ms) {
  const anim = document.querySelector(`#gl-loc-ripple animate`);
  if (!anim) return;
  anim.setAttribute("dur", `${Math.max(1, ms)}ms`);
  anim.beginElement?.();
}

/* ══════════════════════════════════════════════════════════════════════
   The name card
   ══════════════════════════════════════════════════════════════════════ */

let cardTimers = [];

function clearCard() {
  for (const t of cardTimers) window.clearTimeout(t);
  cardTimers = [];
  document.getElementById("gl-loc-card")?.remove();
}

/**
 * Lower-left chyron. Deliberately mounted outside the curtain so it keeps its
 * own timing: at the `off` motion tier the transition collapses to a cut but the
 * card still reads normally, which is the whole reason someone picks that tier.
 */
export function announce(name, subtitle = "", accent = null, delayMs = 0) {
  const text = String(name ?? "").trim();
  if (!text) return;
  clearCard();

  const el = document.createElement("div");
  el.id = "gl-loc-card";
  el.className = "gl-loc-card gl-type";
  if (accent) el.style.setProperty("--gl-accent", accent);
  const sub = String(subtitle ?? "").trim();
  el.innerHTML = `<div class="gl-loc-card-band">
      <div class="gl-loc-card-name">${escapeAttr(text)}</div>
      ${sub ? `<div class="gl-loc-card-sub">${escapeAttr(sub)}</div>` : ""}
    </div>`;
  document.body.appendChild(el);

  cardTimers.push(window.setTimeout(() => el.classList.add("is-in"), Math.max(0, delayMs)));
  cardTimers.push(window.setTimeout(() => el.classList.remove("is-in"), delayMs + CARD_HOLD_MS));
  cardTimers.push(window.setTimeout(() => el.remove(), delayMs + CARD_HOLD_MS + CARD_FADE_MS + 60));
}

/* ══════════════════════════════════════════════════════════════════════
   The curtain
   ══════════════════════════════════════════════════════════════════════ */

let curtain = null;

/**
 * True while a curtain is up on this client. The document write happens under
 * the curtain, so this is exactly the window in which a background change is
 * *ours* — which is how the panel tells our own swap apart from the GM editing
 * the scene by hand.
 */
export const isTravelling = () => curtain !== null;

/** Resolve once the canvas has finished redrawing, or once the cap expires. */
function armRedrawWatch() {
  let settle = null;
  const landed = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      Hooks.off("canvasReady", finish);
      window.clearTimeout(cap);
      resolve();
    };
    // Both a v13 Scene background write and a v14 Level background write end in
    // canvas.draw(), so this one signal covers the redraw on either version.
    const cap = window.setTimeout(finish, REDRAW_CAP_MS);
    Hooks.on("canvasReady", finish);
    settle = finish;
  });
  return { landed, cancel: () => settle?.() };
}

function fitCamera() {
  try {
    const d = canvas?.dimensions;
    if (!d) return;
    const scale = Math.min(window.innerWidth / d.sceneWidth, window.innerHeight / d.sceneHeight);
    canvas.pan({ x: d.sceneX + d.sceneWidth / 2, y: d.sceneY + d.sceneHeight / 2, scale });
  } catch (e) {
    warn("Locations: could not fit the camera.", e);
  }
}

/**
 * Mount the plate. Synchronous and invisible — the plate is a copy of what the
 * canvas is already showing. Returns a handle whose `reveal()` waits out the
 * swap and then destroys it.
 */
function raise({ plateSrc, style, accent, awaitRedraw = true }) {
  ensureDefs();
  curtain?.destroy();

  const { style: resolved, scale } = motionFor(style);
  const spec = STYLES[resolved] ?? STYLES[DEFAULT_STYLE];

  const root = document.createElement("div");
  root.className = "gl-loc-curtain gl-type";
  root.dataset.glLocStyle = resolved;
  root.dataset.glLocMech = spec.mech;
  // Scoped, exactly as core/theme.mjs does for a per-feature motion tier: this
  // one number retimes every --gl-d-* token inside the curtain and nothing else.
  root.style.setProperty("--gl-motion-scale", String(scale));
  if (accent) root.style.setProperty("--gl-accent", accent);

  const src = String(plateSrc ?? "");
  const plate = src
    ? VIDEO_RE.test(src)
      ? `<video class="gl-loc-plate" src="${escapeAttr(src)}" autoplay loop muted playsinline></video>`
      : `<img class="gl-loc-plate" src="${escapeAttr(src)}" alt="" />`
    : `<div class="gl-loc-plate gl-loc-plate-blank"></div>`;

  root.innerHTML = `<div class="gl-loc-stage">
      <div class="gl-loc-platewrap">${plate}</div>
      <div class="gl-loc-veilwrap"><div class="gl-loc-veil"></div></div>
    </div>`;
  document.body.appendChild(root);

  const watch = awaitRedraw ? armRedrawWatch() : null;
  const durMs = () => scaledMs(spec.ms, root);

  const handle = {
    root,
    style: resolved,
    destroy() {
      if (curtain === handle) curtain = null;
      root.remove();
      watch?.cancel();
    },
    /**
     * Wait out the swap, then destroy the plate.
     *
     * The card is handed in rather than scheduled by the caller because its
     * entrance is timed off the *reveal*, and the reveal does not begin until
     * the redraw has landed — a delay measured from the call site would put the
     * card up during the hold, before anything has moved.
     */
    async reveal({ name = "", subtitle = "", accent: cardAccent = null } = {}) {
      if (watch) {
        await watch.landed;
        if (readSetting(SETTING_RECENTER, true)) fitCamera();
        const settle = clampNumber(readSetting(SETTING_SETTLE, SETTLE_DEFAULT_MS), 0, SETTLE_MAX_MS, SETTLE_DEFAULT_MS);
        if (settle > 0) await new Promise((r) => window.setTimeout(r, settle));
      }
      if (!root.isConnected) return;

      const ms = durMs();
      const card = () => {
        if (name) announce(name, subtitle, cardAccent, Math.round(ms * CARD_LEAD));
      };

      if (ms <= 0) {
        card();
        handle.destroy();
        return;
      }
      // One frame so the mounted state paints before the animation binds to it.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      root.classList.add("is-playing");
      card();
      if (resolved === "ripple") playRipple(ms);
      await new Promise((r) => window.setTimeout(r, ms + 40));
      handle.destroy();
    },
  };
  curtain = handle;
  return handle;
}

/* ══════════════════════════════════════════════════════════════════════
   A trip
   ══════════════════════════════════════════════════════════════════════ */

/** Warm the browser cache so the redraw behind the plate is as short as it can be. */
async function predecode(src) {
  if (!src || VIDEO_RE.test(src)) return;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
  } catch {
    /* 404, CORS, or an unsupported format — the redraw will surface it. */
  }
}

/** What a client does when a trip is announced: curtain up, wait, reveal, card. */
async function receive(payload) {
  if (canvas?.scene?.id !== payload?.sceneId) return;
  const handle = raise({
    plateSrc: payload.plateSrc,
    style: payload.style,
    accent: payload.accent,
    awaitRedraw: !payload.preview,
  });
  await handle.reveal({
    name: payload.name,
    subtitle: payload.subtitle,
    accent: payload.accent,
  });
}

let lastPlaylistId = null;

async function swapPlaylist(id) {
  const next = id || null;
  if (next === lastPlaylistId) return;
  try {
    if (lastPlaylistId) await game.playlists?.get(lastPlaylistId)?.stopAll();
    lastPlaylistId = next;
    if (next) await game.playlists?.get(next)?.playAll();
  } catch (e) {
    warn("Locations: playlist swap failed.", e);
  }
}

/**
 * Travel. GM only.
 *
 * The order matters: the curtain goes up on every client *first*, then the
 * document write happens behind it. The playlist starts here too rather than on
 * the reveal — a J-cut, so the new place's audio arrives before its picture and
 * pulls the table forward instead of leaving them in the old room for the length
 * of the transition.
 *
 * @param {object} entry  A deck entry, or an ad-hoc `{img, name, subtitle, …}`.
 * @param {object} [opts]
 * @param {string} [opts.style]    Override the entry's default style.
 * @param {boolean} [opts.card]    Show the name card (default true).
 * @param {boolean} [opts.preview] Local audition: no socket, no document write.
 *   The plate is the *current* backdrop, so a preview auditions the shape and
 *   timing of a style rather than the destination art.
 * @param {string} [opts.fit]      Texture fit for the new backdrop.
 * @returns {Promise<void>} Resolves when this client's reveal has finished.
 */
export async function travel(entry, { style = null, card = true, preview = false, fit = "cover" } = {}) {
  if (!game.user.isGM) return warn("Locations: only the GM can travel.");
  const scene = canvas?.scene;
  if (!scene) return warn("Locations: no active canvas scene.");

  const src = String(entry?.img ?? "").trim();
  if (!src) return warn("Locations: entry has no image.", entry);

  const chosen = STYLES[style] ? style : (STYLES[entry?.style] ? entry.style : DEFAULT_STYLE);
  const accent = hex6(entry?.accent, null);
  const previous = readBackground(scene);

  await predecode(src);

  const payload = {
    type: "travel",
    sceneId: scene.id,
    plateSrc: previous.src ?? "",
    style: chosen,
    accent,
    preview,
    name: card ? String(entry?.name ?? "") : "",
    subtitle: card ? String(entry?.subtitle ?? "") : "",
  };

  // Foundry does not echo a socket to its sender, so the GM runs the same
  // handler directly. Not awaited yet: `receive` blocks on the redraw that only
  // the write below can cause.
  //
  // The emit deliberately precedes the write. The two travel as separate server
  // messages and are not ordered against each other, so a client that somehow
  // received the update first would redraw in the open and then transition on an
  // already-swapped canvas. Sending first makes that vanishingly unlikely; a
  // handshake to make it impossible would cost every client a round trip.
  if (!preview) emitSocket(FEATURE_ID, payload);
  const local = receive(payload);

  if (!preview) {
    await writeBackground(scene, { src, fit, darkness: entry?.darkness ?? null });
    await markTravelled(scene, entry?.id ?? null, previous);
    await swapPlaylist(entry?.playlistId);
  }

  await local;
}

/**
 * Put the scene back to the backdrop it had before its first trip — including
 * its original texture fit, which travel overwrites with `cover`.
 */
export async function goHome(opts = {}) {
  const home = getHome(canvas?.scene);
  if (!home?.src) return warn("Locations: this scene has no recorded home backdrop.");
  await travel(
    { id: null, name: "", img: home.src, style: DEFAULT_STYLE },
    { card: false, fit: home.fit || "fill", ...opts }
  );
}

/** Wire the shared socket. Called from the adapter's onReady. */
export function initSocket() {
  onSocket(FEATURE_ID, (payload) => {
    if (payload?.type !== "travel") return;
    return receive(payload);
  }, {
    validate: (p) => typeof p?.sceneId === "string" && typeof p?.plateSrc === "string",
  });
}

/** Audition a style on this client only. */
export function preview(entry, style = null) {
  return travel(entry, { style, preview: true });
}
