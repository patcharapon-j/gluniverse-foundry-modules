/**
 * Living light and the fog of war as cloud (render/torches.mjs, render/fog.mjs,
 * view/bake.mjs lightData, the LIT torch and fog chunks in render/glsl.mjs).
 *
 * Everything here fails silently: a flicker that wraps snaps once a loop
 * forever, a flicker that strays strobes, a torch kind nobody maps burns
 * steady, a flame drawn in the fog names a lit room nobody has seen, unseen
 * ground painted at all (even as mist), its sun shadow, a backdrop or a bank
 * that reads its height, each outlines a tower nobody has seen, a GM who gets
 * clouds cannot see their own map, a shed rung that maps to
 * nothing never degrades.
 */

import { readFileSync } from "node:fs";

const DIO = "scripts/features/diorama";

/** GLSL smoothstep, for evaluating a shader's own expression. */
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export default async function check(ctx) {
  const read = (rel) => readFileSync(new URL(ctx.url(rel)), "utf8");
  const T = await import(ctx.url(`${DIO}/render/torches.mjs`));
  const Fg = await import(ctx.url(`${DIO}/render/fog.mjs`));
  const G = await import(ctx.url(`${DIO}/render/glsl.mjs`));
  const { createShared } = await import(ctx.url(`${DIO}/render/materials.mjs`));
  const C = await import(ctx.url(`${DIO}/constants.mjs`));
  const O = await import(ctx.url(`${DIO}/options.mjs`));
  const { lightData } = await import(ctx.url(`${DIO}/view/bake.mjs`));

  // ── timing and shedding ──
  const times = ["flickerStep", "flickerGentle", "lightPulse", "torchFade", "flameLick", "emberRise", "fogDrift"];
  ctx.ok("every living-light duration is in TIMING", times.every((k) => Number(C.TIMING[k]) > 0), times.filter((k) => !(C.TIMING[k] > 0)).join(", "));
  const sheds = ["embers", "fogDrift", "torchShadows", "torchFlicker"];
  ctx.ok("every living-light rung is in SHED_ORDER", sheds.every((n) => C.SHED_ORDER.includes(n)), sheds.filter((n) => !C.SHED_ORDER.includes(n)).join(", "));
  const R = await import(ctx.url(`${DIO}/render/renderer.mjs`));
  const proto = R.DioramaRenderer.prototype;
  const fxWith = (off, graphics = {}) => {
    const self = { graphics: { ...O.DEFAULT_GRAPHICS, ...graphics }, options: { tiltShift: false }, shed: { allows: (n) => n !== off } };
    return proto.effectiveFx.call(self, proto.shedFlags.call(self));
  };
  const all = fxWith(null);
  const binds = { embers: "embers", fogDrift: "fogDrift", torchShadows: "torchShadows", torchFlicker: "flicker" };
  const unbound = Object.entries(binds).filter(([rung, field]) => !(all[field] && !fxWith(rung)[field]));
  ctx.ok("each living-light rung turns its own effect off", unbound.length === 0, unbound.map(([r]) => r).join(", "));
  ctx.ok("shedding fogDrift leaves the clouds on (only the drift stops)", fxWith("fogDrift").fog === 1);
  ctx.ok("lightFx off turns every living-light effect off", (() => {
    const f = fxWith(null, { lightFx: false });
    return !f.lightFx && !f.flicker && !f.embers && !f.torchShadows;
  })());

  // ── options ──
  const low = O.resolveGraphics({ quality: "low" }), high = O.resolveGraphics({ quality: "high" });
  ctx.ok("living light and cloud fog follow the quality preset", low.lightFx === false && low.fog === 0 && high.lightFx === true && high.fog === 1);
  ctx.ok("an explicit living-light or fog choice beats its preset",
    O.resolveGraphics({ quality: "low", lightFx: "on", fogStyle: "clouds" }).lightFx === true
    && O.resolveGraphics({ quality: "high", fogStyle: "flat" }).fog === 0);
  ctx.ok("the new options are client graphics", ["lightFx", "fogStyle"].every((n) => O.OPTIONS.find((o) => o.name === n)?.scope === "client"));

  // ── flicker ──
  const kinds = ["fire", "warm", "pulse", "steady"];
  let worstAmp = 0, worstStep = 0;
  for (const kind of kinds) for (const [speed, intensity] of [[1, 1], [5, 5], [10, 10], [0, 0], ["x", null]]) {
    let prev = T.flicker(kind, 0, 1234, speed, intensity);
    for (let t = 1; t <= 30000; t += 1) {
      const f = T.flicker(kind, t, 1234, speed, intensity);
      worstAmp = Math.max(worstAmp, Math.abs(f - 1));
      worstStep = Math.max(worstStep, Math.abs(f - prev));
      prev = f;
    }
  }
  ctx.ok("a flicker stays within 1 ± FLICKER_MAX", worstAmp <= T.FLICKER_MAX + 1e-9, worstAmp.toFixed(4));
  ctx.ok("a flicker is continuous: no jump between two frames a millisecond apart", worstStep < 0.02, worstStep.toFixed(4));
  ctx.ok("a steady light never moves", [0, 7, 1e6, 3.6e7].every((t) => T.flicker("steady", t, 9) === 1));
  // fire and warm never repeat: no period of whole noise steps brings them back
  const fireSeq = (o) => Array.from({ length: 64 }, (_, k) => T.flicker("fire", o + k * 37, 77));
  const base = fireSeq(0);
  const repeats = [1, 2, 4, 8, 16, 32, 64, 128, 256, 1024].map((n) => n * C.TIMING.flickerStep)
    .filter((P) => fireSeq(P).every((v, i) => Math.abs(v - base[i]) < 1e-9));
  ctx.ok("fire flicker is not periodic (it can never snap at a wrap)", repeats.length === 0, repeats.join(", "));
  const P = C.TIMING.lightPulse;
  ctx.ok("a pulse breathes on whole periods (it loops seamlessly)", [0, 0.25, 0.6].every((k) => Math.abs(T.flicker("pulse", k * P, 5) - T.flicker("pulse", k * P + 7 * P, 5)) < 1e-9)
    && Math.abs(T.flicker("pulse", P / 4, 0) - T.flicker("pulse", 3 * P / 4, 0)) > 0.05);
  ctx.ok("value noise is smooth at integer steps", Math.abs(T.valueNoise(3 - 1e-7, 5) - T.valueNoise(3 + 1e-7, 5)) < 1e-5);
  ctx.ok("a faster Foundry speed flickers faster", (() => {
    const changes = (speed) => { let n = 0, p = T.flicker("fire", 0, 3, speed); for (let t = 5; t < 20000; t += 5) { const f = T.flicker("fire", t, 3, speed); if ((f > p) !== (n % 2 === 0)) n++; p = f; } return n; };
    return changes(10) > changes(1);
  })());

  // ── what a light is ──
  const L = (o) => ({ x: 2, z: 2, color: null, anim: { type: null }, ...o });
  const kindsOk = [
    [L({ anim: { type: "torch" } }), "fire"], [L({ anim: { type: "flame" } }), "fire"], [L({ anim: { type: "fire" } }), "fire"],
    [L({ anim: { type: "pulse" } }), "pulse"], [L({ anim: { type: "chroma" } }), "steady"],
    [L({ color: [1, 0.6, 0.2] }), "warm"], [L({ color: [1, 1, 1] }), "steady"], [L({ color: [0.3, 0.5, 1] }), "steady"], [L({}), "steady"],
  ].filter(([l, want]) => T.lightKind(l, []) !== want);
  ctx.ok("light kinds follow the Foundry animation, then the colour", kindsOk.length === 0, kindsOk.map(([l]) => JSON.stringify(l.anim) + JSON.stringify(l.color)).join(" "));
  const brazier = [{ x: 2.1, y: 2, w: 0.8, d: 0.8, label: "Iron brazier" }], crate = [{ x: 2, y: 2, w: 1, d: 1, label: "Crate" }];
  ctx.ok("a warm light on a brazier prop is a fire; on a crate it only wavers",
    T.lightKind(L({ color: [1, 0.55, 0.15] }), brazier) === "fire" && T.lightKind(L({ color: [1, 0.55, 0.15] }), crate) === "warm"
    && T.lightKind(L({ color: [1, 0.55, 0.15] }), [{ ...brazier[0], ghost: true }]) === "warm");
  ctx.ok("a coloured fire burns its colour, firelight stays fire", T.flameRecolor([1, 0.55, 0.15]) === 0 && T.flameRecolor([0.2, 1, 0.3]) > 0.5 && T.flameRecolor(null) === 0);

  // ── the bake's sources ──
  const amb = lightData({ sourceId: "AmbientLight.a1", data: { x: 250, y: 350, dim: 400, bright: 200, color: 0xff9933, alpha: 0.6, elevation: 5, animation: { type: "torch", speed: 3, intensity: 7 } } });
  const tok = lightData({ sourceId: "Token.t1", object: { document: { documentName: "Token", elevation: 10 } }, data: { x: 50, y: 50, dim: 200, bright: 100 } });
  ctx.ok("lightData carries position, radii, colour and animation", amb && amb.x === 250 && amb.dim === 400 && amb.bright === 200 && amb.anim.type === "torch"
    && amb.anim.speed === 3 && amb.color && Math.abs(amb.color[0] - 1) < 1e-6 && amb.tint.every((v) => v >= 0 && v <= 1) && !amb.token, JSON.stringify(amb));
  ctx.ok("lightData marks a token's light and keeps an uncoloured light uncoloured", tok?.token === true && tok.color === null && tok.anim.type === null && tok.elevation === 10);
  ctx.ok("lightData drops a light with no radius", lightData({ data: { x: 1, y: 1, dim: 0, bright: 0 } }) === null);
  const n = T.normalizeSource(amb, { size: 100, distance: 5 });
  ctx.ok("a source becomes cells: position, radius, elevation, bright share", n.x === 2.5 && n.z === 3.5 && n.dim === 4 && n.elev === 1 && Math.abs(n.brightFrac - 0.5) < 1e-9);
  ctx.ok("a source with no position is dropped", T.normalizeSource({ x: "a", y: 1, dim: 100 }, { size: 100 }) === null);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: "l" + i, x: i, z: 0, dim: 3, tint: [1, 1, 1] }));
  const picked = T.pickTorches(many, { x: 0, z: 0 });
  ctx.ok("at most MAX_TORCHES lights shade, the nearest first", picked.length === T.MAX_TORCHES && picked[0].id === "l0" && picked.every((l) => l.x < T.MAX_TORCHES));

  // ── the layer, driven under Node ──
  const shared = createShared();
  const layer = new T.TorchesLayer(shared);
  layer.setGround(() => 0.5);
  const fx = { lightFx: true, flicker: true, embers: true, torchShadows: true };
  const view = { tx: 3, tz: 3, zoom: 1 };
  const standees = { entries: new Map([
    ["a", { root: { visible: true, position: { x: 4, y: 0.5, z: 3 } }, state: { groundQ: 2, widthCells: 1 }, cardH: 1.5 }],
    ["flyer", { root: { visible: true, position: { x: 3, y: 3, z: 4 } }, state: { groundQ: 2, widthCells: 1 }, cardH: 1.5 }],
    ["ghost", { root: { visible: true, position: { x: 3.5, y: 0.5, z: 3 } }, state: { groundQ: 2, ghost: true }, cardH: 1.5 }],
  ]) };
  layer.setSources([
    { id: "torch", x: 300, y: 300, dim: 500, bright: 200, tint: [1, 0.7, 0.4], color: [1, 0.6, 0.25], anim: { type: "torch", speed: 5, intensity: 5 } },
    { id: "held", x: 600, y: 300, dim: 300, bright: 150, tint: [1, 0.8, 0.5], color: [1, 0.6, 0.25], anim: { type: "torch" }, token: true, elevation: 0 },
    { id: "lamp", x: 900, y: 900, dim: 300, bright: 150, tint: [0.9, 0.9, 1], color: null, anim: { type: null } },
  ], { size: 100, distance: 5 });
  let active = layer.frame(1000, 1 / 60, fx, view, standees, 0.01);
  const u = shared;
  ctx.ok("tracked lights reach every lit material", u.uTorchCount.value === 3 && u.uTorchDir.value === 1, `count ${u.uTorchCount.value}`);
  const cols = u.uTorchCol.value.slice(0, 3).map((v) => v.w);
  ctx.ok("each tracked light carries its flicker (steady ones exactly 1)", cols.every((a) => Math.abs(a - 1) <= T.FLICKER_MAX + 1e-9)
    && layer.slots.find((l) => l.id === "lamp") && u.uTorchCol.value[layer.slots.findIndex((l) => l.id === "lamp")].w === 1);
  ctx.ok("a flickering light near the view keeps frames coming", active === true);
  ctx.ok("a torch on the ground burns a flame; a torch a token carries does not", layer.flameGeo.instanceCount === 1 && layer.fires[0].l.id === "torch"
    && Math.abs(layer.flameAttr.aFlame.array[1] - 0.5) < 1e-9);
  ctx.ok("each flame throws EMBERS_PER_FLAME sparks", layer.emberGeo.instanceCount === T.EMBERS_PER_FLAME);
  const sx = layer.shadowAttr.aDir.array;
  ctx.ok("a standing figure throws a shadow away from the light; a flyer and a ghost do not",
    layer.shadowGeo.instanceCount >= 1 && layer.shadowGeo.instanceCount <= 2 && sx[0] > 0.9 && sx[3] > 0 && sx[3] <= T.SHADOW_MAX,
    `${layer.shadowGeo.instanceCount} shadows, dir ${sx[0]?.toFixed(2)}, alpha ${sx[3]?.toFixed(2)}`);
  layer.frame(1016, 1 / 60, { ...fx, torchShadows: false }, view, standees, 0.01);
  ctx.ok("torchShadows shed: no figure shadows, no torch-side shading", layer.shadowGeo.instanceCount === 0 && u.uTorchDir.value === 0);
  const steadyActive = layer.frame(1032, 1 / 60, { ...fx, flicker: false, embers: false }, view, standees, 0.01);
  ctx.ok("torchFlicker shed: every light steady and the flames still (no frames asked)",
    u.uTorchCol.value.slice(0, u.uTorchCount.value).every((v) => v.w === 1) && steadyActive === false && layer.emberGeo.instanceCount === 0);
  const clock0 = layer.flameClock.value;
  layer.frame(1048, 0.5, { ...fx, flicker: false }, view, standees, 0.01);
  ctx.ok("the flames' clock stops while torchFlicker is shed", layer.flameClock.value === clock0);
  layer.frame(1064, 1 / 60, { ...fx, lightFx: false }, view, standees, 0.01);
  ctx.ok("lightFx off: the bake alone, nothing drawn", u.uTorchCount.value === 0 && layer.flameGeo.instanceCount === 0 && layer.emberGeo.instanceCount === 0 && layer.shadowGeo.instanceCount === 0);
  // a light joining the set fades in over TIMING.torchFade
  layer.frame(2000, 1 / 60, fx, view, standees, 0.01);
  layer.setSources([
    { id: "torch", x: 300, y: 300, dim: 500, bright: 200, tint: [1, 0.7, 0.4], anim: { type: "torch" } },
    { id: "new", x: 350, y: 300, dim: 500, bright: 200, tint: [1, 0.7, 0.4], anim: { type: null } },
  ], { size: 100, distance: 5 });
  layer.frame(2016, 0.016, fx, view, standees, 0.01);
  const pNew = layer.presence.get("new");
  let frames = 0;
  while (layer.presence.get("new") < 1 && frames < 500) { layer.frame(2032 + frames * 16, 0.016, fx, view, standees, 0.01); frames++; }
  const fadeMs = (frames + 1) * 16;
  ctx.ok("a light joining the tracked set fades in over TIMING.torchFade", pNew > 0 && pNew < 0.1 && Math.abs(fadeMs - C.TIMING.torchFade) <= 40, `${pNew?.toFixed(3)}, ${fadeMs} ms`);
  layer.dispose();

  // ── the shaders ──
  const LITSRC = G.HEAD;
  ctx.ok("the light bake is shaped by the tracked lights in every lit surface", /vec3 lit = sunlight\(n, sh\) \+ torchLight\(lightAt\(lightXZ\), wp, n\)/.test(LITSRC));
  ctx.ok("torch shading keeps flat ground at the bake (normalised by the floor's own facing)", /\/ \(0\.42 \+ 0\.58 \* max\(l\.y, 0\.0\)\)/.test(LITSRC));
  ctx.ok("standees take torch shading and a rim, and no fog of war over a figure",
    /torchLight\(lightAt\(vFoot\.xz\), p, uFacing\)/.test(G.CARD_FRAG) && /torchKey\(p, tl\)/.test(G.CARD_FRAG)
    && /dioFinishFigure\(lit,/.test(G.CARD_FRAG) && !/dioFinish\(lit/.test(G.CARD_FRAG));
  ctx.ok("the torch rim is device pixels (fwidth)", /cardA\(vUv \+ sd \/ sl \* px \* 2\.5\)/.test(G.CARD_FRAG) && /vec2 px = fwidth\(vUv\)/.test(G.CARD_FRAG));
  ctx.ok("flames and embers draw only where this viewer sees their foot now",
    /seenNow\(aFlame\.xz\) < 0\.5 \? vec4\(2\.0/.test(G.FLAME_VERT) && /seenNow\(aBase\.xz\) < 0\.5 \? vec4\(2\.0/.test(G.EMBER_VERT)
    && /step\(0\.5, texture2D\(uVisionMap, uv\)\.r\)/.test(G.FLAME_VERT));
  ctx.ok("an ember is born and dies at zero (its loop never shows)", /smoothstep\(0\.0, 0\.1, vLife\) \* \(1\.0 - smoothstep\(0\.5, 1\.0, vLife\)\)/.test(G.EMBER_FRAG));
  ctx.ok("embers are never under 1.5 device px", /max\([^;]*uPPx \* 1\.5\)/.test(G.EMBER_VERT));
  ctx.ok("figure shadows only on ground seen now, only where the light reaches", /if \(visionAt\(vWorld\.xz\) < 0\.75\) discard;/.test(G.TORCH_SHADOW_FRAG) && /lightAt\(vWorld\.xz\)/.test(G.TORCH_SHADOW_FRAG));

  // ── the fog of war ──
  // Where nobody has seen, the ground writes nothing at all: no colour, no
  // depth, mist or not. Painting it (even as mist pushed to the far plane) still
  // draws its outline, so an unseen tower's silhouette shows against the room.
  // The gap is filled by the fog's backdrop box, whose shape is the board's own
  // bounding box and which reads no terrain, only the vision bake.
  const discardRule = /if \(v\.r > 0\.5\) return 1\.0;\s*if \(v\.g > 0\.5\) return 0\.5;\s*return 0\.0;/.test(LITSRC);
  const groundFrags = [["TOP", G.TOP_FRAG], ["SIDE", G.SIDE_FRAG], ["WATER", G.WATER_FRAG]];
  const mainOf = (s) => /void main\(\) \{([\s\S]*)\}\s*$/.exec(s)?.[1] ?? "";
  // the discard comes before any write: nothing before it touches the colour
  const beforeDiscard = (s, re) => { const m = mainOf(s); const i = m.search(re); return i < 0 ? null : m.slice(0, i); };
  const noWrite = (pre) => pre !== null && !/gl_FragColor|gl_FragData|gl_FragDepth/.test(pre);
  const topPre = beforeDiscard(G.TOP_FRAG, /float vis = visionAt\(vWorld\.xz\);\s*if \(vis <= 0\.0\) discard;/);
  const waterPre = beforeDiscard(G.WATER_FRAG, /float vis = visionAt\(vWorld\.xz\);\s*if \(vis <= 0\.0\) discard;/);
  const sidePre = beforeDiscard(G.SIDE_FRAG, /if \(vis <= 0\.0 && !plinthOnly\) discard;/);
  ctx.ok("unseen ground writes no colour and no depth (TOP, SIDE, WATER discard it first)",
    discardRule && noWrite(topPre) && noWrite(waterPre) && noWrite(sidePre)
    && groundFrags.every(([, s]) => !/dioUnseen|gl_FragDepth/.test(s)),
    [["TOP", topPre], ["WATER", waterPre], ["SIDE", sidePre]].filter(([, p]) => !noWrite(p)).map(([k]) => k).join(", "));
  // The only unseen thing the side faces still draw is the plinth below the
  // board's lowest ground, dark and the same everywhere.
  ctx.ok("the side faces keep only the plinth where nobody has seen",
    /bool plinthOnly = vis <= 0\.0 && uFogStyle\.x > 0\.5 && mod\(vFlag \+ 0\.25, 2\.0\) < 1\.0\s*&& vWorld\.y < uHeightRange\.x - 0\.05;/.test(G.SIDE_FRAG));
  // The backdrop: a box over the board, at the far plane, deciding from the
  // vision bake alone and painting the bank floor's mist. It must read nothing
  // of the terrain, or its coverage would carry the hidden ground's shape.
  const bdMain = mainOf(G.FOG_BACKDROP_FRAG);
  const bdOwn = G.FOG_BACKDROP_FRAG.slice(G.HEAD.length);
  const noTerrain = !/groundAt|uHeightTex|mapAt|lightAt|fieldAt|sunlight|shadowAt|torchLight|uMap\b|uField\b|uLightMap/.test(bdOwn)
    && !/groundAt|uHeightTex/.test(G.FOG_BACKDROP_VERT);
  ctx.ok("the mist backdrop reads no terrain: the vision bake decides, the bank floor's mist paints",
    noTerrain && /textureLod\(uVisionMap, clamp\(q\.xz \/ uWorldSize, 0\.0, 1\.0\), 0\.0\)/.test(bdMain)
    && /if \(max\(v\.r, v\.g\) <= 0\.5\) \{ hidden = true; break; \}/.test(bdMain) && /if \(!hidden\) discard;/.test(bdMain)
    && /dioFogColor\(0\.0, dioFogNoise\(/.test(bdMain) && /gl_FragColor = vec4\(col, 1\.0\);/.test(bdMain));
  // It writes the far plane on every path (first thing, so a discard cannot
  // leave a path undefined), off for the GM and the flat style.
  ctx.ok("the backdrop sits at the far plane on every path, and is off for the GM and the flat style",
    /^\s*gl_FragDepthEXT = 1\.0;\s*if \(uUseVision < 0\.5 \|\| uFogStyle\.x < 0\.5\) discard;/.test(bdMain));
  // The box covers the board from the plinth to above the bank's top sheet over
  // the tallest ground, so no ray through the bank can miss it.
  const boxOver = Number(/const float FOG_BOX_OVER = ([\d.]+);/.exec(G.FOG_BACKDROP_VERT)?.[1]);
  const bankTop = Fg.FOG_FLOOR + (G.FOG_LAYERS - 1) * Fg.FOG_STEP;
  ctx.ok("the backdrop box spans the board from the plinth to over the bank's top sheet",
    /mix\(uHeightRange\.x - 0\.05, uHeightRange\.y \+ FOG_BOX_OVER, position\.y\)/.test(G.FOG_BACKDROP_VERT)
    && /position\.x \* uWorldSize\.x/.test(G.FOG_BACKDROP_VERT) && /position\.z \* uWorldSize\.y/.test(G.FOG_BACKDROP_VERT)
    && boxOver === G.FOG_BOX_OVER && boxOver >= bankTop, `${boxOver} vs ${bankTop.toFixed(2)}`);
  // Nothing unseen throws a sun shadow: the receiver finds the caster along the
  // key from the map's depth and drops it if nobody has seen it. Driven through
  // the real ShadowPass fit, so the depth-per-cell term is the matrix's own.
  const tap = /float shadowTap\(vec3 p, vec2 o, vec3 wp, float dz\) \{([\s\S]*?)\n\}/.exec(LITSRC)?.[1] ?? "";
  const tapRule = /if \(uUseVision > 0\.5 && uFogStyle\.x > 0\.5 && dz < 0\.0\)/.test(tap)
    && /vec2 cuv = \(wp\.xz \+ uKeyDir\.xz \* \(\(d - p\.z\) \/ dz\)\) \/ uWorldSize;/.test(tap)
    && /textureLod\(uVisionMap, cuv, 0\.0\)/.test(tap) && !/texture2D\(uVisionMap/.test(tap)
    && /if \(max\(cv\.r, cv\.g\) <= 0\.5\) return 1\.0;/.test(tap)
    && /float dz = 0\.5 \* dot\(vec3\(uShadowMatrix\[0\]\[2\], uShadowMatrix\[1\]\[2\], uShadowMatrix\[2\]\[2\]\), uKeyDir\);/.test(LITSRC);
  const casterFound = await (async () => {
    const THREE = await import(ctx.url(`${DIO}/render/three.mjs`));
    const { ShadowPass } = await import(ctx.url(`${DIO}/render/post.mjs`));
    const sh = createShared();
    const pass = new ShadowPass(sh);
    pass.setBounds({ x1: 30, z1: 20, y0: -1, y1: 6 });
    pass.fit();
    const M = sh.uShadowMatrix.value, k = sh.uKeyDir.value;
    const depth = (v) => new THREE.Vector4(v.x, v.y, v.z, 1).applyMatrix4(M).z * 0.5 + 0.5;
    const e = M.elements;
    const dz = 0.5 * (e[2] * k.x + e[6] * k.y + e[10] * k.z);
    const wp = new THREE.Vector3(12.3, 0.5, 7.7);
    const ok = [0.4, 1.7, 3.2].every((t) => {
      const c = wp.clone().addScaledVector(k, t);
      const back = (depth(c) - depth(wp)) / dz;
      return Math.abs(back - t) < 1e-4;
    });
    pass.dispose();
    return ok && dz < 0;
  })();
  ctx.ok("an unseen caster throws no sun shadow (found along the key from the map's depth, explicit LOD)", tapRule && casterFound);
  // Only the backdrop writes gl_FragDepth: anywhere else it would cost the
  // ground its early depth test, and a path that skipped it would be undefined.
  const depthWriters = Object.entries(G.PROGRAMS).filter(([, p]) => /gl_FragDepth/.test(p.fragment)).map(([k]) => k);
  ctx.ok("only the mist backdrop writes depth (the ground keeps its early depth test)",
    depthWriters.length === 1 && depthWriters[0] === "fogBackdrop" && !/gl_FragDepth/.test(G.HEAD), depthWriters.join(", "));
  // The floor is dense over the unseen (even thinned on a flank) and clear where
  // the party has seen, and its edge follows the BLURRED map only: the hard bake
  // cuts a line, and where the bank lies above the ground that line floats off
  // its footprint as a dark slab.
  const floor = /if \(vLayer < 0\.5\) \{[\s\S]*?float veil = 0\.6 \* smoothstep\(0\.04, 0\.5, unseen \+ 0\.2 \* \(n - 0\.5\)\);\s*float dense = 1\.0 - smoothstep\(0\.3, 0\.65, 1\.0 - unseen \+ 0\.2 \* \(n - 0\.5\)\);\s*a = max\(dense \* \(1\.0 - \(1\.0 - FOG_FLANK\) \* flank\), veil\);/.test(G.FOG_FRAG);
  const flankMatch = /const float FOG_FLANK = ([\d.]+);/.exec(G.FOG_FRAG);
  const flankK = flankMatch ? Number(flankMatch[1]) : 0;
  const floorA = (unseen, n, flank) => Math.max((1 - smoothstep(0.3, 0.65, 1 - unseen + 0.2 * (n - 0.5))) * (1 - (1 - flankK) * flank),
    0.6 * smoothstep(0.04, 0.5, unseen + 0.2 * (n - 0.5)));
  const grid = Array.from({ length: 11 }, (_, i) => i / 10);
  const denseUnseen = grid.every((n) => grid.every((f) => [0.85, 0.9, 1].every((u) => floorA(u, n, f) >= 0.5)));
  const clearSeen = grid.every((n) => floorA(0, n, 0) < 0.05);
  const fogMain = /void main\(\) \{([\s\S]*)\}\s*$/.exec(G.FOG_FRAG)?.[1] ?? "";
  ctx.ok("the fog floor is dense over the unseen, clear where seen, and edged by the blurred map only",
    floor && denseUnseen && clearSeen && !/uVisionMap/.test(fogMain), `flank ${flankK}`);
  ctx.ok("the GM (no vision bake) and the flat style get no mist",
    /if \(uUseVision < 0\.5 \|\| uFogStyle\.x < 0\.5\) discard;/.test(G.FOG_FRAG) && /if \(uUseVision < 0\.5 \|\| uFogStyle\.x < 0\.5\) return c;/.test(LITSRC));
  ctx.ok("the shadow reaches full mist where nobody has seen, in the bank's own colour",
    /float shadow = smoothstep\(0\.16 \* n, 0\.5, unseen\);/.test(LITSRC) && /return mix\(c, dioFogColor\(0\.0, n\), shadow\)/.test(LITSRC)
    && /dioFogColor\(k, n\)/.test(G.FOG_FRAG));
  const driftMatch = /const float FOG_DRIFT_CELLS = ([\d.]+);/.exec(LITSRC);
  ctx.ok("the fog's drift is a straight translation (non-repeating, no wrap) at fog.mjs's rate",
    /q\.x -= uFogStyle\.y \* FOG_DRIFT_CELLS/.test(LITSRC) && !/fract\([^)]*uFogStyle/.test(LITSRC) && !/mod\([^)]*uFogStyle/.test(LITSRC)
    && !!driftMatch && Number(driftMatch[1]) === Fg.FOG_DRIFT_CELLS, driftMatch?.[1]);
  // The bank follows only ground the party has seen: averaging hidden ground
  // too lifts it into a mound the shape of a hill or tower nobody has seen.
  ctx.ok("the bank lies along the mean SEEN ground around each vertex, flat on the lowest ground over the unseen",
    Fg.FOG_FLOOR > 0 && /float top = fogGround\(position\.xz\) \+ uFogLevel\.x \+ layer \* uFogLevel\.y;/.test(G.FOG_VERT)
    && /float s = fogKnown\(xz \+ o\);\s*h \+= s \* max\(groundAt\(xz \+ o\), uHeightRange\.x\);\s*w \+= s;/.test(G.FOG_VERT)
    && /return step\(0\.5, max\(v\.r, v\.g\)\);/.test(G.FOG_VERT) && /\(vec2\(float\(i\), float\(j\)\) - 3\.5\) \* 0\.5 \* uFogCell/.test(G.FOG_VERT)
    && /return mix\(uHeightRange\.x, h \/ max\(w, 1\.0\), smoothstep\(0\.0, 12\.0, w\)\);/.test(G.FOG_VERT)
    && (G.FOG_VERT.match(/groundAt\(/g) ?? []).length === 1 + (G.FOG_VERT.match(/float groundAt\(/g) ?? []).length);
  ctx.ok("the curtain hangs to the plinth (where the side faces' own plinth begins)",
    /mix\(top, uHeightRange\.x - 0\.05, skirt\)/.test(G.FOG_VERT) && /vWorld\.y < uHeightRange\.x - 0\.05 && uFogStyle\.x > 0\.5/.test(G.SIDE_FRAG));
  const geo = Fg.fogGeometry(4, 3);
  const layers = geo.getAttribute("layer").array, skirts = geo.getAttribute("skirt").array, idx = geo.getIndex().array;
  const order = [...idx].map((i) => layers[i]);
  ctx.ok("the bank is FOG_LAYERS sheets, the floor and its curtain drawn first", Fg.FOG_LAYERS === G.FOG_LAYERS
    && new Set(layers).size === Fg.FOG_LAYERS && order[0] === 0 && order.every((k, n) => n === 0 || k >= order[n - 1]));
  const skirtFeet = [...skirts].map((s, i) => [s, layers[i]]).filter(([s]) => s === 1);
  const pa = geo.getAttribute("position").array;
  const onEdge = [...skirts].every((s, i) => s === 0 || pa[i * 3] < 0.01 || pa[i * 3] > 3.99 || pa[i * 3 + 2] < 0.01 || pa[i * 3 + 2] > 2.99);
  ctx.ok("the curtain closes all four sides, on the floor only", skirtFeet.length === 2 * 2 * (4 + 3) && skirtFeet.every(([, k]) => k === 0) && onEdge, `${skirtFeet.length} feet`);
  ctx.ok("a big board gets coarser bank cells, never more vertices", Fg.fogCell(40, 30) === 1 && Fg.fogCell(500, 40) === Math.ceil(500 / Fg.FOG_MAX_SIDE)
    && (() => { const g2 = Fg.fogGeometry(500, 40); const n = g2.getAttribute("layer").count; g2.dispose(); return n < (Fg.FOG_MAX_SIDE + 2) * 20 * Fg.FOG_LAYERS + 4000; })());
  const p = geo.getAttribute("position").array;
  const nY = (() => { const a = [p[idx[0] * 3], p[idx[0] * 3 + 2]], b = [p[idx[1] * 3], p[idx[1] * 3 + 2]], c = [p[idx[2] * 3], p[idx[2] * 3 + 2]];
    return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); })();
  ctx.ok("the bank faces up (seen from above, never culled)", nY > 0);
  geo.dispose();

  const fogShared = createShared();
  fogShared.uWorldSize.value.set(10, 8);
  const fog = new Fg.FogLayer(fogShared);
  const fxOn = { fog: 1, fogDrift: true };
  fog.setVision(null);
  const THREE_F = await import(ctx.url(`${DIO}/render/three.mjs`));
  ctx.ok("the mist backdrop is a box drawn from inside, behind everything, never picked",
    fog.backdrop?.material?.side === THREE_F.BackSide && fog.backdrop.renderOrder < 0 && fog.backdrop.frustumCulled === false
    && fog.backdrop.parent === fog.group && (() => { const h = []; fog.backdrop.raycast(null, h); return h.length === 0; })());
  ctx.ok("no vision bake: the mist is off and asks for no frames", fog.frame(0.1, fxOn) === false && fogShared.uFogStyle.value.x === 0
    && fog.mesh.visible === false && fog.backdrop.visible === false);
  fog.setVision({ width: 160, height: 128 });   // a stand-in canvas: under Node the soft map stays blank
  const drifting = fog.frame(0.5, fxOn);
  const t1 = fogShared.uFogStyle.value.y;
  ctx.ok("with vision and mist: drawn with its backdrop, its clock one tick per TIMING.fogDrift", drifting && fogShared.uFogStyle.value.x === 1
    && fog.mesh.visible && fog.backdrop.visible && Math.abs(t1 - 500 / C.TIMING.fogDrift) < 1e-9);
  ctx.ok("fogDrift shed: the mist holds still and asks for no frames", fog.frame(0.5, { fog: 1, fogDrift: false }) === false && fogShared.uFogStyle.value.y === t1 && fogShared.uFogStyle.value.x === 1);
  ctx.ok("flat fog: no mist and no backdrop", fog.frame(0.5, { fog: 0, fogDrift: true }) === false && fogShared.uFogStyle.value.x === 0
    && fog.backdrop.visible === false);
  const cps = Fg.FogLayer.cellsPerSecond();
  ctx.ok("the mist drifts slowly (under a tenth of a cell a second)", cps > 0.005 && cps < 0.1
    && Math.abs(cps - (Fg.FOG_DRIFT_CELLS * 1000) / C.TIMING.fogDrift) < 1e-9, cps.toFixed(4));
  ctx.ok("the bank is fitted to the board", (() => { fog.frame(0.1, fxOn); const a = fog.mesh.geometry.getAttribute("position").array; return Math.max(...a.filter((_, i) => i % 3 === 0)) === 10 && Math.max(...a.filter((_, i) => i % 3 === 2)) === 8; })());
  fog.dispose();

  // ── the view hands the renderer the sources ──
  const bake = read(`${DIO}/view/bake.mjs`);
  ctx.ok("the bake hands the renderer its light sources", /this\.onBaked\(\{ darkness, light: this\.light, vision, sources \}\)/.test(bake));
  const rsrc = read(`${DIO}/render/renderer.mjs`);
  ctx.ok("setLighting feeds the torches and the fog", /this\.torches\.setSources\(sources, this\.grid\)/.test(rsrc) && /this\.fog\.setVision\(vision\)/.test(rsrc)
    && /this\.torches\.frame\(/.test(rsrc) && /this\.fog\.frame\(/.test(rsrc) && /this\.torches\.setProps\(/.test(rsrc));
}
