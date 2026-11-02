/**
 * Diorama — Sequencer / JB2A effects mirrored into 3D.
 *
 * Sequencer is not bundled and was not installed when this was written, so it
 * is read defensively against its documented surface: the hooks
 * `createSequencerEffect(effect)` and `endedSequencerEffect(effect)`, a
 * CanvasEffect that is a PIXI container (`x`, `y`, `rotation`, `alpha`) with
 * `data` (`file`, `stretchTo`, `attachTo`, `source`, `target`), a `sprite`
 * whose texture's resource source is the playing <video>/<img>, and
 * `sourcePosition` / `targetPosition` getters for beams. Anything missing
 * degrades to "not mirrored", never to an error.
 *
 * Orientation: a GM override per file path (world setting dio.effectOrient)
 * wins; else a beam when it stretches to a target or its path names a ray;
 * flat when it is attached to a template or its path names an aura / marker;
 * else standing. The light is the effect's dominant colour, sampled once from
 * an 8×8 frame (a tainted cross-origin video samples to the accent).
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { PALETTE, rgbToHex } from "../../../core/theme.mjs";
import { SETTINGS } from "../constants.mjs";

export const ORIENTATIONS = Object.freeze(["standing", "flat", "beam"]);
const BEAM_RE = /ray|beam|bolt|line/i;
const FLAT_RE = /aura|ground|circle|marker|template/i;

/**
 * Pure classification.
 * @param {{file?:string, stretch?:boolean, onTemplate?:boolean}} e
 * @param {Record<string,string>} [overrides]  file path → orientation
 */
export function classifyEffect({ file = "", stretch = false, onTemplate = false } = {}, overrides = {}) {
  const f = String(file ?? "");
  const o = overrides && typeof overrides === "object" ? overrides[f] : null;
  if (ORIENTATIONS.includes(o)) return o;
  if (stretch || BEAM_RE.test(f)) return "beam";
  if (onTemplate || FLAT_RE.test(f)) return "flat";
  return "standing";
}

const isTemplateRef = (v) => {
  if (!v) return false;
  if (typeof v === "string") return /MeasuredTemplate|Region/.test(v);
  const name = v.documentName ?? v.document?.documentName;
  return name === "MeasuredTemplate" || name === "Region";
};

/** The token id an effect's attachment names (a Token, its document, a uuid or a bare id), else null. */
export function tokenIdOf(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const m = /(?:^|\.)Token\.([A-Za-z0-9]{16})/.exec(v);
    if (m) return m[1];
    return globalThis.canvas?.tokens?.get?.(v) ? v : null;
  }
  if (typeof v !== "object") return null;
  const doc = v.documentName === "Token" ? v : v.document?.documentName === "Token" ? v.document : null;
  if (doc?.id) return String(doc.id);
  if (v.uuid || v.id) return tokenIdOf(String(v.uuid ?? v.id));
  return null;
}

function fileOf(effect) {
  const f = effect?.data?.file;
  if (typeof f === "string") return f;
  return String(effect?.data?.file?.file ?? effect?.data?.file?.path ?? "");
}

function mediaOf(effect) {
  return effect?.video
    ?? effect?.sprite?.texture?.baseTexture?.resource?.source
    ?? effect?.texture?.baseTexture?.resource?.source
    ?? null;
}

/** Average colour of the bright pixels of a small frame, as "#rrggbb". */
export function dominantColor(media) {
  try {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 8;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(media, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, w = 0;
    for (let k = 0; k < d.length; k += 4) {
      const lum = (d[k] + d[k + 1] + d[k + 2]) / 765;
      const a = d[k + 3] / 255;
      const weight = lum * lum * a;
      r += d[k] * weight; g += d[k + 1] * weight; b += d[k + 2] * weight; w += weight;
    }
    if (w <= 0.001) return null;
    return rgbToHex({ r: Math.round(r / w), g: Math.round(g / w), b: Math.round(b / w) });
  } catch {
    return null;
  }
}

function overrides() {
  try { return game.settings.get(SUITE_ID, SETTINGS.effectOrient) ?? {}; } catch { return {}; }
}

export class SequencerMirror {
  /**
   * @param {{onChange:() => void, groundQ:(x:number, y:number) => number, allowLights:() => boolean}} o
   */
  constructor({ onChange, groundQ }) {
    this.onChange = onChange;
    this.groundQ = groundQ;
    this.effects = new Map(); // effect → { id, kind, color }
    this.hooks = [];
    this.active = !!globalThis.game?.modules?.get("sequencer")?.active;
    if (!this.active) return;
    this.hooks.push(["createSequencerEffect", Hooks.on("createSequencerEffect", (e) => this.add(e))]);
    this.hooks.push(["endedSequencerEffect", Hooks.on("endedSequencerEffect", (e) => this.remove(e))]);
    // Effects already playing when the view opened.
    try {
      const live = globalThis.Sequencer?.EffectManager?.effects ?? [];
      for (const e of live) this.add(e);
    } catch { /* none */ }
  }

  get size() { return this.effects.size; }

  add(effect) {
    if (!effect || this.effects.has(effect)) return;
    const sceneId = effect.data?.sceneId ?? effect.sceneId;
    if (sceneId && sceneId !== globalThis.canvas?.scene?.id) return;
    const file = fileOf(effect);
    const kind = classifyEffect({
      file,
      stretch: !!effect.data?.stretchTo,
      onTemplate: isTemplateRef(effect.data?.attachTo) || isTemplateRef(effect.data?.source) || isTemplateRef(effect.source),
    }, overrides());
    const id = String(effect.id ?? effect.data?.id ?? `seq-${this.effects.size}-${file}`);
    this.effects.set(effect, { id, kind, color: null, sampled: false });
    this.onChange();
  }

  remove(effect) {
    if (this.effects.delete(effect)) this.onChange();
  }

  /**
   * Current EffectState list (positions follow attached effects every call).
   * @param {((tokenId:string) => boolean)|null} [tokenSeen]  whether a token is on this
   *   viewer's board: an effect attached to (or cast from) one that is not is not drawn,
   *   or it would outline a hidden creature (a GM's "view as players" included)
   */
  states(tokenSeen = null) {
    const out = [];
    for (const [effect, meta] of this.effects) {
      if (effect.destroyed || effect._ended) { this.effects.delete(effect); continue; }
      if (tokenSeen && [effect.data?.attachTo, effect.data?.source, effect.data?.stretchTo, effect.data?.target, effect.source, effect.target]
        .some((v) => { const id = tokenIdOf(v); return id && !tokenSeen(id); })) continue;
      const source = mediaOf(effect);
      if (!source) continue;
      if (!meta.sampled && (source.videoWidth || source.naturalWidth || source.width)) {
        meta.sampled = true;
        meta.color = dominantColor(source) ?? PALETTE.accent;
      }
      const a = effect.sourcePosition ?? { x: effect.x, y: effect.y };
      const b = effect.targetPosition ?? null;
      const x = Number(a?.x) || 0, y = Number(a?.y) || 0;
      const w = Math.abs(Number(effect.sprite?.width) || Number(effect.width) || 0);
      const h = Math.abs(Number(effect.sprite?.height) || Number(effect.height) || 0);
      if (!(w > 0 && h > 0)) continue;
      const zQ = this.groundQ(x, y);
      const x2 = b ? Number(b.x) || x : x, y2 = b ? Number(b.y) || y : y;
      out.push({
        id: meta.id,
        kind: meta.kind,
        source,
        x, y, zQ,
        x2, y2, z2Q: b ? this.groundQ(x2, y2) : zQ,
        widthPx: w,
        heightPx: h,
        // degrees (render/effects.mjs); a PIXI container's `rotation` is radians
        rotation: Number.isFinite(Number(effect.angle)) ? Number(effect.angle) : ((Number(effect.rotation) || 0) * 180) / Math.PI,
        alpha: Number.isFinite(Number(effect.alpha)) ? Number(effect.alpha) : 1,
        light: meta.color ? { color: meta.color, radius: Math.max(w, h) / 2 } : null,
      });
    }
    return out;
  }

  dispose() {
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = [];
    this.effects.clear();
  }
}
