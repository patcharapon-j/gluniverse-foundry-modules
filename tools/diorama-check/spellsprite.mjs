/**
 * Spellsprite in the view: the pixel effect kinds and the mirror that feeds them.
 *
 * All of it fails silently. A pixel quad sampled LINEAR is a blur that reads as
 * "the art is low-res"; one blended ADDITIVE loses every outline and smoke
 * underside darker than the ground; a texture re-made every frame is a GPU
 * upload and an allocation per frame while every still looks right; a mirror
 * that throws on a missing api takes the whole view down in a world where
 * pf2e-fx is switched off; and an idle mirror that still reports itself live
 * keeps the renderer drawing forever on a table where nothing moves.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIO = "scripts/features/diorama";

/** A stand-in for a canvas under Node: effects.mjs only asks for its size. */
class FakeCanvas {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return null; }
}

export default async function (ctx) {
  const THREE = await import(ctx.url(`${DIO}/render/three.mjs`));
  const { MATERIALS, createShared } = await import(ctx.url(`${DIO}/render/materials.mjs`));
  const { EffectsLayer, pixelTexture, PIXEL_KINDS, PIXEL_PUSH } = await import(ctx.url(`${DIO}/render/effects.mjs`));
  const { CARD_DEPTH_NUDGE } = await import(ctx.url(`${DIO}/render/glsl.mjs`));
  const { DioramaRenderer } = await import(ctx.url(`${DIO}/render/renderer.mjs`));
  const SP = await import(ctx.url(`${DIO}/integrations/spellsprite.mjs`));

  // ---- the texture: nearest, no mipmaps --------------------------------------
  const t = pixelTexture(new FakeCanvas(8, 8));
  ctx.ok("pixel texture is NEAREST (mag and min)", t.magFilter === THREE.NearestFilter && t.minFilter === THREE.NearestFilter);
  ctx.ok("pixel texture builds no mipmaps", t.generateMipmaps === false);
  t.dispose();

  // ---- the materials: normal for art, additive for the light pool ------------
  const shared = createShared();
  const art = MATERIALS.pixel(shared, {});
  const glow = MATERIALS.pixel(shared, { additive: true });
  ctx.ok("pixel art blends NORMAL", art.blending === THREE.NormalBlending, String(art.blending));
  ctx.ok("pixel light pool blends ADDITIVE", glow.blending === THREE.AdditiveBlending, String(glow.blending));
  ctx.ok("pixel materials write no depth", art.depthWrite === false && glow.depthWrite === false);
  ctx.ok("pixel materials are transparent", art.transparent && glow.transparent);
  art.dispose(); glow.dispose();

  ctx.ok("a standing pixel quad clears the card's depth nudge", PIXEL_PUSH > CARD_DEPTH_NUDGE,
    `PIXEL_PUSH ${PIXEL_PUSH} ≤ CARD_DEPTH_NUDGE ${CARD_DEPTH_NUDGE}`);

  // ---- the layer: one texture per quad, re-uploaded only on a new version ----
  const hadOff = "OffscreenCanvas" in globalThis;
  const prevOff = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = FakeCanvas;
  try {
    const layer = new EffectsLayer(shared);
    const canvases = Object.fromEntries(PIXEL_KINDS.map((k) => [k, new FakeCanvas(64, 32)]));
    const states = (version) => PIXEL_KINDS.map((kind) => ({
      id: `s:${kind}`, kind, source: canvases[kind], version, box: { x: 0, y: 0, w: 40, h: 20 },
      aps: 26, x: 500, y: 500, zQ: 0, anchor: { ax: 20, ay: 18 },
    }));
    layer.setPixels(states(1));
    const es = PIXEL_KINDS.map((k) => layer.pixels.get(`s:${k}`));
    ctx.ok("every pixel kind builds a quad", es.every((e) => e?.mesh && e.texture));
    for (const e of es) {
      const m = e.mesh.material, tex = e.texture;
      ctx.ok(`${e.kind}: nearest, no mipmaps`, tex.magFilter === THREE.NearestFilter && tex.minFilter === THREE.NearestFilter && !tex.generateMipmaps);
      const want = e.kind === "pixel-light" ? THREE.AdditiveBlending : THREE.NormalBlending;
      ctx.ok(`${e.kind}: ${e.kind === "pixel-light" ? "additive" : "normal"} blending`, m.blending === want);
      ctx.ok(`${e.kind}: no depth write`, m.depthWrite === false);
    }
    const tex0 = es[0].texture, v0 = tex0.version;
    layer.setPixels(states(1));
    ctx.ok("same version: the texture is kept and not re-uploaded",
      layer.pixels.get(es[0].id).texture === tex0 && tex0.version === v0, `version ${v0} → ${tex0.version}`);
    layer.setPixels(states(2));
    ctx.ok("new version: the same texture is re-uploaded in place",
      layer.pixels.get(es[0].id).texture === tex0 && tex0.version > v0);
    canvases["pixel-standing"].width = 128;
    layer.setPixels(states(3));
    ctx.ok("a grown canvas gets new storage", layer.pixels.get(es[0].id).texture !== tex0);
    const b = layer.pixels.get(es[0].id).mesh.material.uniforms.uBox.value;
    ctx.ok("uBox maps the drawn box (flipY)", Math.abs(b.x - 40 / 128) < 1e-9 && Math.abs(b.y - 20 / 32) < 1e-9 && Math.abs(b.w - (1 - 20 / 32)) < 1e-9);

    // existing kinds are untouched: additive unlit, shared texture
    layer.set([{ id: "seq", kind: "standing", source: new FakeCanvas(16, 16), x: 0, y: 0, zQ: 0 }]);
    const seq = layer.entries.get("seq");
    ctx.ok("a Sequencer effect still blends additive", seq?.mesh.material.blending === THREE.AdditiveBlending);
    ctx.ok("a Sequencer effect is not a pixel quad", seq && !seq.pixel);

    layer.setPixels([]);
    layer.set([]);
    ctx.ok("clearing drops every quad", layer.pixels.size === 0 && layer.entries.size === 0 && layer.group.children.length === 0);
    layer.pixelLive = false;
    ctx.ok("an empty layer asks for no frames", layer.animated === false);
  } finally {
    if (hadOff) globalThis.OffscreenCanvas = prevOff; else delete globalThis.OffscreenCanvas;
  }

  // ---- the api lookup fails closed ------------------------------------------
  const hadGame = "game" in globalThis, prevGame = globalThis.game;
  try {
    delete globalThis.game;
    ctx.ok("fxApi: no game is null", SP.fxApi() === null);
    globalThis.game = { modules: { get: () => undefined } };
    ctx.ok("fxApi: no suite module is null", SP.fxApi() === null);
    globalThis.game = { modules: { get: () => ({ api: { features: {} } }) } };
    ctx.ok("fxApi: no pf2e-fx feature is null", SP.fxApi() === null);
    globalThis.game = { modules: { get: () => ({ api: { features: { [SP.FX_FEATURE]: { sims: 3 } } } }) } };
    ctx.ok("fxApi: a non-function sims is null", SP.fxApi() === null);
    globalThis.game = { modules: { get: () => { throw new Error("boom"); } } };
    ctx.ok("fxApi: a throwing lookup is null", SP.fxApi() === null);
    const api = { sims: () => [] };
    globalThis.game = { modules: { get: () => ({ api: { features: { [SP.FX_FEATURE]: api } } }) } };
    ctx.ok("fxApi: a real api is returned", SP.fxApi() === api);
    delete globalThis.game;
    let off = null;
    try { off = SP.onFxChange(() => {}); } catch { off = null; }
    ctx.ok("onFxChange without game or Hooks still returns an unsubscribe", typeof off === "function");
    try { off?.(); } catch { ctx.ok("onFxChange unsubscribe does not throw", false); }
  } finally {
    if (hadGame) globalThis.game = prevGame; else delete globalThis.game;
  }

  // ---- the mirror fails closed, and costs nothing idle ----------------------
  const view = { rx: 1, ry: 0, fx: 0, fy: -1, pitch: 0.5, pxWorld: 0.01, size: 100, now: 0 };
  const cases = [
    ["sims throws", () => { throw new Error("gone"); }],
    ["sims returns null", () => null],
    ["sims returns an object", () => ({ key: "a" })],
    ["a row with no sim", () => [{ key: "a" }]],
    ["a sim with no parts", () => [{ key: "a", sim: { lights: [], shed: new Set() } }]],
    ["a sim with no shed set", () => [{ key: "a", sim: { parts: [], lights: [], shed: [] } }]],
    ["a row with no key", () => [{ sim: { parts: [], lights: [], shed: new Set() } }]],
    ["nothing running", () => []],
  ];
  let first = null, same = true;
  for (const [name, sims] of cases) {
    const m = new SP.SpellspriteMirror({ sims, groundQ: () => 0 });
    let out;
    try { out = m.frame(view); } catch (e) { ctx.ok(`mirror (${name}) does not throw`, false, e?.message); continue; }
    ctx.ok(`mirror (${name}) is idle`, out && out.live === false && Array.isArray(out.effects) && !out.effects.length && !out.react && !out.shake);
    ctx.ok(`mirror (${name}) builds no scratch buffers`, m.side === null && m.top === null && m.entries.size === 0);
    first ??= out;
    if (out !== first) same = false;
  }
  ctx.ok("an idle frame allocates nothing (one frozen result)", same && Object.isFrozen(first));
  ctx.ok("no constructor arguments is a working idle mirror", new SP.SpellspriteMirror().frame(view).live === false);

  // ---- the renderer side: idle asks for no frames, a throw is contained -----
  const fake = () => ({
    pixelSource: null, _pixelWarned: false,
    _pixelView: { yaw: 0, pitch: 0, rx: 1, ry: 0, fx: 0, fy: -1, pxWorld: 0.01, size: 100, now: 0 },
    rig: { view: { yaw: Math.PI / 4, pitch: 0.5 }, shake: null, setShake(x, y) { this.shake = [x, y]; return true; } },
    grid: { size: 100 },
    effects: { pixelLive: true, list: null, setPixels(l) { this.list = l; } },
    standees: { react: 1, setReactions(f) { this.react = f; } },
  });
  const pf = DioramaRenderer.prototype.pixelFrame;
  const r1 = fake();
  ctx.ok("no pixel source: not live", pf.call(r1, 0, 0.01) === false);
  const r2 = fake();
  r2.pixelSource = new SP.SpellspriteMirror({ sims: () => [] });
  const live2 = pf.call(r2, 0, 0.01);
  ctx.ok("an idle mirror is not live, and clears the layer, reactions and shake",
    live2 === false && r2.effects.pixelLive === false && Array.isArray(r2.effects.list) && !r2.effects.list.length
      && r2.standees.react === null && r2.rig.shake?.[0] === 0 && r2.rig.shake?.[1] === 0);
  const r3 = fake();
  r3.pixelSource = { frame() { throw new Error("bad sim"); } };
  const err = console.error; let warned = 0; console.error = () => { warned++; };
  try {
    const a = pf.call(r3, 0, 0.01), b = pf.call(r3, 16, 0.01);
    ctx.ok("a throwing pixel source is contained and not live", a === false && b === false && r3.effects.pixelLive === false);
    ctx.ok("a throwing pixel source warns once", warned === 1, `${warned} warnings`);
  } finally { console.error = err; }
  const v = r2._pixelView;
  ctx.ok("the view's right and away axes are the camera's (yaw π/4)",
    Math.abs(v.rx - Math.cos(Math.PI / 4)) < 1e-9 && Math.abs(v.ry + Math.sin(Math.PI / 4)) < 1e-9
      && Math.abs(v.fx + Math.sin(Math.PI / 4)) < 1e-9 && Math.abs(v.fy + Math.cos(Math.PI / 4)) < 1e-9);

  // ---- reactions ------------------------------------------------------------
  const hit = { at: 0, k: 1, from: { x: 0, y: 0 }, R: [[255, 0, 0], [255, 128, 0], [255, 255, 0]] };
  const r0 = SP.hitReaction(hit, 0, 1, 0);
  ctx.ok("a hit's first frame flashes white", r0?.flash && r0.flash[0] === 1 && r0.flash[1] === 1 && r0.flash[2] === 1);
  ctx.ok("a hit knocks back away from its source", r0 && r0.dx > 0 && Math.abs(r0.dz) < 1e-9);
  ctx.ok("a hit at the origin knocks nowhere (x = 0 is a coordinate)", (() => {
    const r = SP.hitReaction({ ...hit, from: { x: 0, y: 0 } }, 0.01, 0, 0);
    return r && r.dx === 0 && r.dz === 0;
  })());
  ctx.ok("a hit ends after its span", SP.hitReaction(hit, SP.REACT.span, 1, 0) === null);

  // ---- the wiring: the view asks through fxApi, never game directly ---------
  const overlay = readFileSync(join(ctx.root, `${DIO}/view/overlay.mjs`), "utf8");
  ctx.ok("overlay builds the mirror through fxApi()?.sims(...) ?? []",
    /fxApi\(\)\?\.sims\([^)]*\)\s*\?\?\s*\[\]/.test(overlay));
  ctx.ok("overlay disposes the mirror and unsubscribes", /S\.unSprite\?\.\(\)/.test(overlay) && /S\.sprite\?\.dispose\(\)/.test(overlay));
  const mirror = readFileSync(join(ctx.root, `${DIO}/integrations/spellsprite.mjs`), "utf8");
  ctx.ok("spellsprite.mjs reads game only through globalThis", !/(^|[^.\w])game\./m.test(mirror.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
}
