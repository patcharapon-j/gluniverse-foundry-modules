/**
 * Props (terrain/props.mjs, terrain/props-store.mjs, render/props.mjs, the
 * editor's props mode).
 *
 * A prop is stored data and a rule at once: a solid one is raised ground for
 * movement and sight. Everything here fails silently. A key the normaliser
 * drops forgets a GM's edit on the next load; a hidden prop that reaches the
 * stamp lets a player feel a wall they cannot see; a nested update merges and a
 * deleted prop comes back; a uniform with no value holds whatever the driver
 * starts with; a dynamic label key with no entry prints its own name.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function check(ctx) {
  const P = await import(ctx.url("scripts/features/diorama/terrain/props.mjs"));
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { KIND, SUB, SHED_ORDER, FLAG_PROPS } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const { SUITE_ID } = await import(ctx.url("scripts/core/const.mjs"));
  const {
    PROP_SHAPES, PROP_MATERIALS, SHAPE_DEFAULTS, normalizeProp, normalizeProps, propToJSON,
    resolveProps, propStates, stampStates, footprintCells, propAt,
  } = P;

  // ── the model ──
  ctx.ok("every shape has defaults", PROP_SHAPES.every((s) => SHAPE_DEFAULTS[s] && PROP_MATERIALS.includes(SHAPE_DEFAULTS[s].mat)));
  ctx.ok("unusable entries come back null",
    [null, 3, [], {}, { shape: "statue", x: 1, y: 1 }, { shape: "box", x: "a", y: 1 }, { shape: "box", x: 1 }].every((r) => normalizeProp(r) === null));
  const d = normalizeProp({ shape: "pillar", x: 2.5, y: 3.5 });
  ctx.ok("a bare prop takes its shape's defaults", d && d.w === 0.7 && d.h === 3 && d.mat === "marble" && d.solid && !d.hidden && d.elev === null && d.rot === 0 && d.tint === null && d.img === "",
    JSON.stringify(d));
  const c = normalizeProp({ shape: "box", x: 1, y: 1, w: 999, h: 0, rot: -90, mat: "gold", tint: "#AABBCC", solid: "yes", hidden: 1, label: "x".repeat(99), img: "a.png", elev: "" });
  ctx.ok("the normaliser clamps and refuses junk", c.w === P.SIZE_MAX && c.h === P.H_MIN && c.rot === 270 && c.mat === "stone" && c.tint === "#aabbcc"
    && c.solid === true && c.hidden === false && c.label.length === 60 && c.img === "" && c.elev === null, JSON.stringify(c));
  ctx.ok("a card keeps a long path whole and drops an overlong one rather than cutting it",
    normalizeProp({ shape: "card", x: 0, y: 0, img: "a/".repeat(400) + "x.webp" }).img.length === 806
    && normalizeProp({ shape: "card", x: 0, y: 0, img: "data:image/png;base64," + "A".repeat(P.IMG_MAX) }).img === "");
  const STORED = ["id", "shape", "x", "y", "w", "d", "h", "elev", "rot", "mat", "tint", "solid", "hidden", "label", "roof"];
  ctx.ok("the stored form is exactly the documented keys", JSON.stringify(Object.keys(propToJSON(d))) === JSON.stringify(STORED)
    && JSON.stringify(Object.keys(propToJSON(normalizeProp({ shape: "card", x: 0, y: 0 })))) === JSON.stringify([...STORED, "img"]));
  const raw = [{ shape: "box", x: 1, y: 1 }, { shape: "box", x: 1, y: 1 }, { id: "keep", shape: "rock", x: 2, y: 2 }, { id: "keep", shape: "rock", x: 3, y: 3 }];
  const n1 = normalizeProps(raw), n2 = normalizeProps(raw);
  ctx.ok("ids are unique and minted deterministically", new Set(n1.map((p) => p.id)).size === 4 && n1.map((p) => p.id).join() === n2.map((p) => p.id).join() && n1[2].id === "keep",
    n1.map((p) => p.id).join());
  ctx.ok("a normalised list is a fixed point", JSON.stringify(normalizeProps(n1.map(propToJSON)).map(propToJSON)) === JSON.stringify(n1.map(propToJSON)));

  // ── footprints and stamping ──
  const ground = Terrain.blank(8, 8, (i, j) => j < 7);   // the last column is void
  const box = normalizeProp({ id: "b", shape: "box", x: 2, y: 2, w: 2, d: 2, h: 1 });
  ctx.ok("a 2×2 box covers 4×4 sub-cells", footprintCells(box).filter((q) => q.f > 0).length === 4 * SUB * SUB / 4 * 4);
  const R = resolveProps(ground, normalizeProps([
    box,
    { id: "c", shape: "crate", x: 2, y: 2, w: 1, d: 1, h: 0.5 },
    { id: "w", shape: "wedge", x: 5.5, y: 5.5, h: 1, rot: 90 },
    { id: "h", shape: "box", x: 5.5, y: 1.5, h: 3, hidden: true },
    { id: "s", shape: "bush", x: 1.5, y: 6.5 },
    { id: "v", shape: "box", x: 7.5, y: 3.5, h: 2 },
  ]));
  const t = R.terrain;
  ctx.ok("the ground passed in is never changed", ground.cellTop(2, 2) === 0 && t !== ground);
  ctx.ok("a solid prop raises the ground under it", t.topAt(2, 2) === 4 && t.kindAt(2, 2) === KIND.FLOOR, String(t.topAt(2, 2)));
  ctx.ok("a prop placed later stands on an earlier solid one", R.props[1].baseQ === 4 && t.cellTop(2, 2) === 6, JSON.stringify([R.props[1].baseQ, t.cellTop(2, 2)]));
  ctx.ok("a wedge stamps a ramp descending to its front", t.kindAt(11, 10) === KIND.RAMP || t.kindAt(11, 11) === KIND.RAMP, JSON.stringify([t.kindAt(11, 10), t.kindAt(11, 11)]));
  ctx.ok("a hidden prop is never stamped", t.cellTop(1, 5) === 0 && R.props[3].stamped === false);
  ctx.ok("a prop that is not solid is never stamped", t.cellTop(6, 1) === 0 && R.props[4].stamped === false);
  ctx.ok("void stays void under a prop", t.isVoid(7, 14) && t.isVoid(7, 15));
  const off = resolveProps(ground, normalizeProps([box]), { stamp: false });
  ctx.ok("with the setting off the rules are the ground itself", off.terrain === ground && off.props[0].stamped === false);
  ctx.ok("propAt finds the topmost prop under a point", propAt(R.props, 2, 2)?.id === "c" && propAt(R.props, 0.2, 7.8) === null);

  // ── what each viewer receives ──
  const gm = propStates(R.props, { isGM: true }), pl = propStates(R.props, { isGM: false });
  ctx.ok("a player never receives a hidden prop", !pl.some((s) => s.id === "h") && pl.length === gm.length - 1);
  ctx.ok("the GM sees it as a ghost that blocks nothing", gm.find((s) => s.id === "h")?.ghost === true && gm.find((s) => s.id === "h")?.blocks === false);
  ctx.ok("states carry the base in cells", gm.find((s) => s.id === "c")?.base === 1);
  const ss = stampStates(ground, gm);
  ctx.ok("the renderer's restamp matches the rules", ss.cellTop(2, 2) === t.cellTop(2, 2) && ss.cellTop(1, 5) === 0);

  // ── the store ──
  const { propsUpdate, PropStore } = await import(ctx.url("scripts/features/diorama/terrain/props-store.mjs"));
  const upd = propsUpdate({ initialLevel: { id: "L1" } }, [box, { shape: "box", x: 1, y: 1 }]);
  const key = Object.keys(upd)[0];
  ctx.ok("a write is a forced replacement of one Level's entry", Object.keys(upd).length === 1
    && key === `flags.${SUITE_ID}.${FLAG_PROPS}.levels.==L1` && upd[key].v === P.PROP_FORMAT && upd[key].props.length === 2, key);
  ctx.ok("touched: the dotted key setFlag sends", PropStore.touched({ flags: { [SUITE_ID]: { [FLAG_PROPS]: {} } } }));
  ctx.ok("touched: the nested shape", PropStore.touched({ flags: { [SUITE_ID]: { dio: { props: {} } } } }));
  ctx.ok("touched: a forced key beneath either", PropStore.touched({ flags: { [SUITE_ID]: { dio: { "==props": {} } } } })
    && PropStore.touched({ flags: { [SUITE_ID]: { [`${FLAG_PROPS}.levels.==L1`]: {} } } }));
  ctx.ok("touched: not by the terrain", !PropStore.touched({ flags: { [SUITE_ID]: { dio: { terrain: {} } } } }) && !PropStore.touched({}));
  const scene = { initialLevel: null, getFlag: (s, k) => (s === SUITE_ID && k === FLAG_PROPS ? { levels: { default: { v: 1, props: [box, { shape: "nope" }] } } } : undefined) };
  ctx.ok("read normalises and drops the unusable", PropStore.read(scene).length === 1 && PropStore.has(scene));

  // ── the editor's props tool and session ──
  const T = await import(ctx.url("scripts/features/diorama/editor/props-tool.mjs"));
  const one = T.makeProp([], { shape: "crate", mat: "wood", x: 2.3, y: 4.9, snap: true });
  ctx.ok("a snapped placement centres on the square", one && one.x === 2.5 && one.y === 4.5, JSON.stringify(one));
  const { EditorSession, TOOLS, MODES } = await import(ctx.url("scripts/features/diorama/editor/session.mjs"));
  ctx.ok("props editing is a mode, not a tenth tool", TOOLS.length === 9 && MODES.join() === "terrain,props");
  const S = new EditorSession({ terrain: Terrain.blank(8, 8), grid: { size: 100, cols: 8, rows: 8, distance: 5, units: "ft" }, walls: [], props: [] });
  S.setMode("props");
  S.down({ x: 250, y: 250, si: 4, sj: 4 }); S.up({ x: 250, y: 250 });
  const placed = S.props[0];
  ctx.ok("a click places the palette's shape and selects it", S.props.length === 1 && placed.shape === "box" && S.propTool.selected === placed.id);
  S.down({ x: 250, y: 250 }); S.move({ x: 550, y: 450 }); S.up({ x: 550, y: 450 });
  ctx.ok("a drag moves the prop, snapped", S.props[0].x === 5.5 && S.props[0].y === 4.5, JSON.stringify(S.props[0]));
  S.updateProp(placed.id, { h: 2, tint: "#ff0000" });
  S.duplicateProp();
  ctx.ok("duplicate adds a second prop and selects it", S.props.length === 2 && S.propTool.selected !== placed.id);
  S.removeProp();
  S.undo();
  ctx.ok("undo restores a removed prop", S.props.length === 2);
  S.undo(); S.undo();
  ctx.ok("undo walks back a duplicate and an edit", S.props.length === 1 && S.props[0].h === 1 && S.props[0].x === 5.5, JSON.stringify(S.props[0]));
  S.undo();
  ctx.ok("undo walks back a move", S.props[0].x === 2.5, JSON.stringify(S.props[0]));
  S.redo(); S.redo();
  ctx.ok("redo replays them", S.props.length === 1 && S.props[0].x === 5.5 && S.props[0].h === 2);
  S.down({ x: 550, y: 450, shift: true });
  ctx.ok("shift-click removes", S.props.length === 0);
  S.replace(Terrain.blank(8, 8), "layout", { props: [{ shape: "rock", x: 1, y: 1 }] });
  S.undo();
  ctx.ok("a layout's props and terrain are one undo step", S.props.length === 0);

  // ── rendering ──
  const { buildPropGeometries, SHAPE_PARTS, UNPARTED, PROP_MATERIAL_FACTORIES, PROP_MATERIAL_PROGRAM, PropsLayer } = await import(ctx.url("scripts/features/diorama/render/props.mjs"));
  const { PROPS_PROGRAMS, PROP_MAT_ID, PROP_PART_ID } = await import(ctx.url("scripts/features/diorama/render/props-glsl.mjs"));
  const { declaredUniforms } = await import(ctx.url("scripts/features/diorama/render/glsl.mjs"));
  const { createShared } = await import(ctx.url("scripts/features/diorama/render/materials.mjs"));
  const G = buildPropGeometries();
  const unit = Object.entries(G).filter(([k, g]) => {
    const p = g.attributes.position.array;
    for (const v of p) if (!Number.isFinite(v)) return true;
    const b = g.boundingBox;
    if (k === "contact") return false;
    return b.min.x < -0.501 || b.max.x > 0.501 || b.min.z < -0.501 || b.max.z > 0.501 || b.min.y < -1e-3 || b.max.y > 1.001;
  }).map(([k]) => k);
  ctx.ok("every prop geometry is unit-sized, standing on y = 0, with no NaN", unit.length === 0, unit.join(", "));
  const noParts = PROP_SHAPES.filter((s) => !SHAPE_PARTS[s] || (!UNPARTED.includes(s) && !SHAPE_PARTS[s].length));
  ctx.ok("every shape is drawn by parts", noParts.length === 0, noParts.join(", "));
  const noGeo = Object.values(SHAPE_PARTS).flat().filter((p) => !(p.geo === "rock" ? G.rock0 : G[p.geo])).map((p) => p.geo);
  ctx.ok("every part's geometry exists", noGeo.length === 0, noGeo.join(", "));
  ctx.ok("every material has a shader id", PROP_MATERIALS.every((m) => Number.isInteger(PROP_MAT_ID[m])) && new Set(Object.values(PROP_MAT_ID)).size === PROP_MATERIALS.length);
  const parts = new Set(Object.values(SHAPE_PARTS).flat().map((p) => p.part ?? "plain"));
  ctx.ok("every part has a shader id", [...parts].every((p) => Number.isInteger(PROP_PART_ID[p])), [...parts].filter((p) => !Number.isInteger(PROP_PART_ID[p])).join());

  const shared = createShared();
  for (const [name, make] of Object.entries(PROP_MATERIAL_FACTORIES)) {
    const prog = PROPS_PROGRAMS[PROP_MATERIAL_PROGRAM[name]];
    if (!ctx.ok(`prop material ${name} names a program`, !!prog)) continue;
    const m = make(shared, { mat: "foliage", foliage: true });
    const declared = [...new Set([...declaredUniforms(prog.vertex), ...declaredUniforms(prog.fragment)])];
    const unset = declared.filter((u) => !m.uniforms || !(u in m.uniforms) || m.uniforms[u].value === undefined);
    ctx.ok(`prop material ${name}: every declared uniform has a value`, unset.length === 0, unset.join(", "));
    ctx.ok(`prop material ${name}: declares something to check`, declared.length > 0);
    m.dispose();
  }
  const orphan = Object.keys(PROPS_PROGRAMS).filter((p) => !Object.values(PROP_MATERIAL_PROGRAM).includes(p));
  ctx.ok("every prop program is built by a factory", orphan.length === 0, orphan.join(", "));

  const layer = new PropsLayer(shared);
  layer.setTerrain(ground);
  layer.set(propStates(R.props, { isGM: true }));
  const instanced = [...layer.buckets.values()].reduce((n, b) => n + b.mesh.count, 0);
  // the casters keep their own matrices: a ghost's is a zero scale, so it draws nothing
  const castsAt = (b, i) => b.caster.instanceMatrix.array.subarray(i * 16, i * 16 + 16).some((v, k) => k !== 15 && v !== 0);
  const castingOf = (L0) => [...L0.buckets.values()].reduce((n, b) => { for (let i = 0; i < b.caster.count; i++) if (castsAt(b, i)) n++; return n; }, 0);
  const casting = castingOf(layer);
  const parts0 = gm.reduce((n, s) => n + SHAPE_PARTS[s.shape].length, 0);
  ctx.ok("one instance per part, in shared buckets", instanced === parts0 && layer.buckets.size < parts0, `${instanced} of ${parts0} in ${layer.buckets.size}`);
  ctx.ok("a ghost casts no shadow", casting === parts0 - SHAPE_PARTS.box.length, `${casting}`);
  ctx.ok("contact shadows skip ghosts", layer.contact.count === gm.length - 1);
  ctx.ok("the renderer stands overlays on the stamped rules", layer.rules && layer.rules.cellTop(2, 2) === t.cellTop(2, 2));
  ctx.ok("a still board asks for no frames", !layer.animated({ detail: 1 }));
  layer.setEnvironment({ wind: { x: 1, z: 0, speed: 0.6 } });
  ctx.ok("foliage sways only in wind, at detail, with foliage on the board", layer.animated({ detail: 1 }) && !layer.animated({ detail: 0 }));
  layer.set(gm.filter((s) => s.shape !== "bush"));
  ctx.ok("no foliage, no sway", !layer.animated({ detail: 1 }));
  layer.dispose();
  ctx.ok("propDetail is a shed step", SHED_ORDER.includes("propDetail"));

  await checkNewShapes(ctx, { P, Terrain, KIND, SUB, shared, G, SHAPE_PARTS, PropsLayer });

  // A frame must allocate nothing: no `new`, no literal arrays or objects in frame().
  const rsrc = readFileSync(join(ctx.root, "scripts/features/diorama/render/props.mjs"), "utf8");
  const body = rsrc.slice(rsrc.indexOf("  frame(_t"), rsrc.indexOf("  /** The nearest BLOCKING"));
  ctx.ok("PropsLayer.frame allocates nothing", body.length > 0 && !/\bnew\s|\[\s*\]|=\s*\{|\.\.\./.test(body.replace(/\/\/.*$/gm, "")));
  // The model cache outlives a view: its textures hold each renderer's dispose
  // listener and with it that renderer's GL context, so closing the view must
  // let go of the cache's GPU copies or every closed view's context leaks (#168).
  const msrc = readFileSync(join(ctx.root, "scripts/features/diorama/render/props-models.mjs"), "utf8");
  const disposeBody = rsrc.slice(rsrc.lastIndexOf("  dispose() {"));
  ctx.ok("closing the view releases the model cache's GPU copies",
    /releaseModelGpu\(\);/.test(disposeBody)
      && /export function releaseModelGpu\(\) \{\s*for \(const e of cache\.values\(\)\) disposeModel\(e\.model\);\s*\}/.test(msrc)
      && /p\.geometry\?\.dispose\(\);\s*p\.map\?\.dispose\(\);\s*p\.emissiveMap\?\.dispose\(\);/.test(msrc));

  // ── strings ──
  const lang = JSON.parse(readFileSync(join(ctx.root, "lang/diorama-props.en.json"), "utf8"));
  ctx.ok("props lang keys are flat and namespaced", Object.keys(lang).every((k) => k.startsWith("GLDIO.props.") && typeof lang[k] === "string"));
  const dyn = [...PROP_SHAPES.map((s) => `GLDIO.props.shape.${s}`), ...PROP_MATERIALS.map((m) => `GLDIO.props.mat.${m}`), "GLDIO.props.mode.terrain", "GLDIO.props.mode.props",
    ...P.MODEL_RULES.map((r) => `GLDIO.props.rules.${r}`)];
  const used = new Set(dyn);
  for (const f of ["scripts/features/diorama/editor/app.mjs", "templates/diorama/editor.hbs", "scripts/features/diorama/editor/layer.mjs"]) {
    for (const m of readFileSync(join(ctx.root, f), "utf8").matchAll(/GLDIO\.props\.[A-Za-z0-9_.]+[A-Za-z0-9_]/g)) used.add(m[0]);
  }
  // A template literal's head (`GLDIO.props.shape.${key}`) is a family, covered by `dyn`.
  const missing = [...used].filter((k) => !(k in lang) && !dyn.some((x) => x.startsWith(`${k}.`)));
  ctx.ok("every props string the editor reads has an entry", missing.length === 0, missing.join(", "));
  const prefix = Object.keys(lang).filter((k) => Object.keys(lang).some((o) => o.startsWith(`${k}.`)));
  ctx.ok("no props key is another's prefix", prefix.length === 0, prefix.join(", "));
  const mod = JSON.parse(readFileSync(join(ctx.root, "module.json"), "utf8"));
  ctx.ok("module.json loads the props strings and styles", mod.languages.some((l) => l.path === "lang/diorama-props.en.json") && mod.styles.includes("styles/diorama-props.css"));

  // ── the stylesheet keeps to tokens ──
  const css = readFileSync(join(ctx.root, "styles/diorama-props.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ctx.ok("props CSS uses no raw colour", !/#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i.test(css));
  ctx.ok("props CSS uses no raw duration", !/\b\d+(\.\d+)?m?s\b/.test(css));
  ctx.ok("props CSS keeps the gldio- prefix", [...css.matchAll(/\.([a-z][\w-]*)/g)].every((m) => /^(gldio-|gl-|is-)/.test(m[1])));
}

/**
 * The shapes past the first eighteen: slabs (off-grid terrain), the new
 * primitives, kits, models and roof fades. Each fails quietly in its own way:
 * a slab that stamps the w × d box instead of its outline lets a token walk on
 * the painted cliff's air; a kit that stamps its roof lifts whoever stands
 * under it; a model with no file grounds a shadow under nothing; a faded roof
 * that still casts keeps the room it opened dark.
 */
async function checkNewShapes(ctx, { P, Terrain, KIND, SUB, shared, G, SHAPE_PARTS, PropsLayer }) {
  const { normalizeProp, normalizeProps, propToJSON, resolveProps, propStates, footprintCells, inPolygon, wedgeDir } = P;
  const R = await import(ctx.url("scripts/features/diorama/render/props.mjs"));
  const M = await import(ctx.url("scripts/features/diorama/render/props-models.mjs"));
  const S = await import(ctx.url("scripts/features/diorama/render/props-slabs.mjs"));
  const GL = await import(ctx.url("scripts/features/diorama/render/props-glsl.mjs"));
  const THREE = await import(ctx.url("scripts/features/diorama/render/three.mjs"));
  const { fireProp } = await import(ctx.url("scripts/features/diorama/render/torches.mjs"));
  const { CLIFF_MATERIALS } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const NEW = P.PROP_SHAPES.slice(P.PROP_SHAPES.indexOf("slab"));
  const own = (s) => ({ ...(s === "kit" ? { parts: [{ shape: "box", x: 0, y: 0 }] } : {}), ...(s === "model" ? { src: "m.glb" } : {}) });

  // ── the model ──
  const bare = NEW.map((s) => [s, normalizeProp({ shape: s, x: 3.5, y: 3.5, ...own(s) })]);
  const unfixed = bare.filter(([, p]) => !p || JSON.stringify(propToJSON(normalizeProp(propToJSON(p)))) !== JSON.stringify(propToJSON(p))).map(([s]) => s);
  ctx.ok("every new shape normalises from a bare placement and is a fixed point", unfixed.length === 0, unfixed.join(", "));
  ctx.ok("roof shapes are roofs and scenery by default, every other shape is neither a roof",
    P.ROOF_SHAPES.every((s) => { const p = normalizeProp({ shape: s, x: 1, y: 1 }); return p.roof && !p.solid; })
    && !normalizeProp({ shape: "box", x: 1, y: 1 }).roof && normalizeProp({ shape: "box", x: 1, y: 1, roof: true }).roof
    && normalizeProp({ shape: "gable", x: 1, y: 1, roof: false }).roof === false);
  const slab0 = normalizeProp({ shape: "slab", x: 1, y: 1, points: [[1, 1], [3.4, 1], [3.4, 2.6], [1, 2.6]], cliff: "metal" });
  ctx.ok("a slab's outline is kept relative to its own middle, its bounds are its size",
    slab0.x === 3.2 && slab0.y === 2.8 && slab0.w === 2.4 && slab0.d === 1.6 && slab0.points[0][0] === -1.2 && slab0.cliff === "metal", JSON.stringify(slab0));
  ctx.ok("a slab's sides take a cliff material, metal included", CLIFF_MATERIALS.includes("metal")
    && normalizeProp({ shape: "slab", x: 1, y: 1, cliff: "gold" }).cliff === "stone");
  ctx.ok("an outline keeps three-decimal corners (a painted rim is measured finer than a sixteenth)",
    normalizeProp({ shape: "slab", x: 0, y: 0, points: [[0.1234, 0], [1, 0.0005], [0.5, 1]] }).points.some((q) => q[0] === -0.438));
  const model = normalizeProp({ shape: "model", x: 1, y: 1, src: "a/b.glb", scale: "0", rules: "weird" });
  ctx.ok("a model keeps its file, fits when unscaled, and defaults to a box in the rules", model.src === "a/b.glb" && model.scale === null && model.rules === "box",
    JSON.stringify(model));
  ctx.ok("a kit with no usable part is not a prop", normalizeProp({ shape: "kit", x: 1, y: 1, parts: [{ shape: "kit" }, { shape: "slab" }] }) === null);
  const kit = normalizeProp({ shape: "kit", kit: "stall", x: 4, y: 4, rot: 90, parts: [
    { shape: "box", x: -0.5, y: 0, w: 1, d: 1, h: 0.5, solid: true },
    { shape: "gable", x: 0, y: 0, w: 2, d: 1, h: 0.5, elev: 0.5, solid: false },
  ] });
  ctx.ok("a kit is stored inline: its parts centred, its height the tallest part's top", kit && kit.parts.length === 2 && kit.h === 1 && kit.w === 2 && kit.parts[0].x === -0.5,
    JSON.stringify(kit));

  // ── the rules ──
  const ground = Terrain.blank(10, 10);
  const tri = normalizeProp({ id: "tri", shape: "slab", x: 2, y: 2, points: [[-1.2, -0.7], [1.3, -0.7], [0.2, 1.1]], h: 0.75 });
  const want = new Set();
  for (let si = 0; si < 10 * SUB; si++) for (let sj = 0; sj < 10 * SUB; sj++) {
    const x = (sj + 0.5) / SUB, y = (si + 0.5) / SUB;
    if (inPolygon(tri.points.map(([px, py]) => [px + tri.x, py + tri.y]), x, y)) want.add(`${si},${sj}`);
  }
  const T1 = resolveProps(ground, [tri]).terrain;
  const got = new Set();
  for (let si = 0; si < T1.sh; si++) for (let sj = 0; sj < T1.sw; sj++) if (T1.topAt(si, sj) === 3) got.add(`${si},${sj}`);
  ctx.ok("a slab stamps exactly the half squares whose centre its outline covers, as floor at its top",
    want.size > 4 && got.size === want.size && [...want].every((k) => got.has(k)) && T1.kindAt(4, 4) === KIND.FLOOR, `${got.size} of ${want.size}`);
  const tiny = normalizeProp({ shape: "slab", x: 1, y: 1, w: 0.2, d: 0.2 });
  ctx.ok("a slab claims no half square it does not cover (no centre fallback)", footprintCells(tiny).length === 0);
  const turned = normalizeProp({ shape: "slab", x: 5, y: 5, w: 3, d: 1, rot: 30 });
  const tc = footprintCells(turned);
  const outside = tc.filter((c) => { const [u, v] = P.localOf(turned, (c.sj + 0.5) / SUB, (c.si + 0.5) / SUB); return Math.abs(u) > 0.5 || Math.abs(v) > 0.5; });
  ctx.ok("a turned rectangle slab claims only what it covers", tc.length >= 10 && outside.length === 0, `${tc.length}, ${outside.length} outside`);
  const st = resolveProps(ground, [normalizeProp({ shape: "stairs", x: 5, y: 5, w: 1, d: 2, h: 1 })]).terrain;
  const flight = [8, 9, 10, 11].map((si) => st.topAt(si, 9));
  ctx.ok("a flight of stairs is a ramp in the rules, descending to its front",
    flight[0] > flight[3] && flight.every((h, i) => !i || h <= flight[i - 1]) && st.kindAt(10, 9) === KIND.RAMP && st.dirAt(10, 9) === wedgeDir(0),
    JSON.stringify(flight));
  const fence = normalizeProp({ shape: "fence", x: 4, y: 6.25, w: 2, d: 0.15 });
  const fc = footprintCells(fence);
  ctx.ok("a fence is never stepped over: its centre line claims a full row of half squares", fc.length >= 4 && fc.every((c) => c.si === 12), JSON.stringify(fc.map((c) => [c.si, c.sj])));
  const placedKit = normalizeProps([{ ...propToJSON(kit), id: "kit" }])[0];
  const KT = resolveProps(ground, [placedKit]).terrain;
  const kitTops = footprintCells(placedKit).map((c) => KT.topAt(c.si, c.sj));
  ctx.ok("a kit stamps the union of its solid parts, never its scenery roof",
    Math.max(...kitTops) === 2 && kitTops.some((h) => h === 0), JSON.stringify([...new Set(kitTops)]));
  const scenery = normalizeProp({ shape: "kit", x: 4, y: 4, parts: [{ shape: "gable", x: 0, y: 0, solid: false }] });
  ctx.ok("a kit of scenery is not in the rules", resolveProps(ground, [scenery]).props[0].stamped === false);
  ctx.ok("a model with no rules footprint stamps nothing, a boxed one its box",
    resolveProps(ground, [normalizeProp({ shape: "model", x: 4, y: 4, src: "a.glb", rules: "none" })]).props[0].stamped === false
    && resolveProps(ground, [normalizeProp({ shape: "model", x: 4.5, y: 4.5, src: "a.glb" })]).terrain.topAt(8, 8) === 4);

  // ── drawing ──
  const warns = [];
  const warn0 = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  M.setModelLoader(async (src) => {
    if (src === "bad.glb") throw new Error("not a model");
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: 0x808080 }));
    mesh.position.set(5, 3, 0);
    scene.add(mesh);
    return M.bakeScene(scene);
  });
  try {
    const raw = NEW.map((s, i) => ({ id: `n${i}`, shape: s, x: 1.5 + (i % 7) * 1.4, y: 1.5 + Math.floor(i / 7) * 2.5, ...own(s) }));
    raw.push({ id: "poly", shape: "slab", x: 2, y: 8, points: [[0, 0], [2.2, 0.3], [1.5, 1.6], [0.1, 1.2]], h: 0.5 });
    raw.push({ id: "path", shape: "pipe", x: 5, y: 8, path: [[0, 0, 0.2], [1.2, 0, 0.2], [1.2, 1, 0.7]], thick: 0.2 });
    raw.push({ id: "extr", shape: "extrude", x: 7, y: 8, h: 0.4, points: [[0, 0], [1, 0], [0.5, 0.9]] });
    raw.push({ id: "turn", shape: "lathe", x: 9, y: 8, profile: [[0, 0], [1, 0.2], [0.3, 1]] });
    raw.push({ id: "bad", shape: "model", x: 9, y: 9, src: "bad.glb" });
    const res = resolveProps(Terrain.blank(12, 12), normalizeProps(raw));
    const gmStates = propStates(res.props, { isGM: true }), plStates = propStates(res.props, { isGM: false });
    const L = new PropsLayer(shared);
    L.setTerrain(Terrain.blank(12, 12));
    L.set(gmStates);
    await new Promise((r) => setTimeout(r, 20));
    const drawnIds = new Set();
    for (const b of L.buckets.values()) for (let i = 0; i < b.mesh.count; i++) drawnIds.add(b.states[i].id);
    for (const r of L.slabs.ranges) drawnIds.add(r.id);
    const blank = gmStates.filter((s) => !drawnIds.has(s.id)).map((s) => s.shape);
    ctx.ok("every new shape draws (a slab as terrain, a kit as its parts, a model from its file)", blank.length === 0, blank.join(", "));
    const variants = [...L.dyn.entries()].filter(([k]) => /^(stairs|fence|hip|lathe):/.test(k));
    const outOfBox = variants.filter(([, g]) => { const b = g.boundingBox; return b.min.x < -0.501 || b.max.x > 0.501 || b.min.z < -0.501 || b.max.z > 0.501 || b.min.y < -1e-3 || b.max.y > 1.001; });
    ctx.ok("variant geometries (steps, posts, pitch, profile) stay in the unit box", variants.length >= 3 && outOfBox.length === 0, outOfBox.map(([k]) => k).join());
    const ownG = [...L.dyn.entries()].filter(([k]) => /^(extrude|pipe):/.test(k));
    const ownBad = ownG.filter(([k, g]) => {
      const s = gmStates.find((x) => x.id === (k.startsWith("pipe") ? "path" : "extr"));
      const b = g.boundingBox;
      return [...g.attributes.position.array].some((v) => !Number.isFinite(v)) || b.min.y < -1e-3 || b.max.y > s.h + 0.01
        || b.max.x - b.min.x > s.w + 0.01 || b.max.z - b.min.z > s.d + 0.01;
    });
    ctx.ok("an extrusion and a path pipe are built at their own size, inside their bounds", ownG.length === 2 && ownBad.length === 0, ownBad.map(([k]) => k).join());
    const modelBucket = [...L.buckets.entries()].find(([k, b]) => k.startsWith("model|") && b.mesh.count);
    ctx.ok("a model draws with the suite's own light (the props model program)", !!modelBucket && modelBucket[1].material.fragmentShader === GL.PROPS_PROGRAMS.propModel.fragment);
    const bake = M.bakeScene((() => { const s = new THREE.Scene(); const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1)); m.position.set(5, 3, 0); s.add(m); return s; })());
    ctx.ok("a baked model stands on y = 0, centred, its native size kept", bake.size.join() === "2,1,1"
      && Math.abs(bake.parts[0].geometry.boundingBox.min.y) < 1e-6 && Math.abs(bake.parts[0].geometry.boundingBox.min.x + 1) < 1e-6);
    ctx.ok("a model is drawn at a uniform scale: fit inside its box, or its own scale", M.modelScale([2, 1, 1], { w: 1, d: 1, h: 3 }) === 0.5
      && M.modelScale([2, 1, 1], { w: 1, d: 1, h: 3, scale: 0.25 }) === 0.25);
    const ghostBox = [...L.buckets.values()].some((b) => b.states.some((s, i) => s.id === "bad" && i < b.mesh.count && b.info.getY(i) === 1));
    ctx.ok("a model that cannot load is a hatched box the GM sees, with no shadow under it",
      ghostBox && !L.contact || (ghostBox && ![...Array(L.contact.count).keys()].some((i) => {
        const e = new THREE.Matrix4(); L.contact.getMatrixAt(i, e); const v = new THREE.Vector3().setFromMatrixPosition(e); return Math.abs(v.x - 9) < 1e-6 && Math.abs(v.z - 9) < 1e-6;
      })));
    ctx.ok("a failed model warns once", warns.filter((w) => w.includes("bad.glb")).length === 1, warns.join(" | "));
    const PLL = new PropsLayer(shared);
    PLL.set(plStates.map((s) => (s.id === "bad" ? { ...s, gm: false } : s)));
    const plGhost = [...PLL.buckets.values()].some((b) => b.states.some((s, i) => s.id === "bad" && i < b.mesh.count));
    ctx.ok("a player never sees a model's placeholder", !plGhost);
    PLL.dispose();

    // slabs draw like terrain
    const sg = S.buildSlabGeometry(gmStates.filter((s) => s.shape === "slab"), () => 0);
    const tp = sg.top.getAttribute("position").array, te = sg.top.getAttribute("aEdge").array;
    let down = 0, nan = 0;
    for (let i = 0; i < tp.length; i += 9) {
      const ax = tp[i], az = tp[i + 2], bx = tp[i + 3], bz = tp[i + 5], cx = tp[i + 6], cz = tp[i + 8];
      if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < -1e-9) down++;
    }
    for (const a of [tp, sg.side.getAttribute("position").array]) for (const v of a) if (!Number.isFinite(v)) nan++;
    ctx.ok("a slab's top faces the sky, with no NaN", down === 0 && nan === 0, `${down} down, ${nan} NaN`);
    ctx.ok("a slab's top carries the terrain lip: 0 at its rim, past the bevel inside", sg.ranges.every((r) => r.lip) && Math.min(...te) === 0 && Math.max(...te) >= 0.09);
    const sp = sg.side.getAttribute("position").array, sn = sg.side.getAttribute("normal").array;
    let inward = 0;
    for (let i = 0; i < sp.length; i += 9) {
      const u = [sp[i + 3] - sp[i], sp[i + 4] - sp[i + 1], sp[i + 5] - sp[i + 2]], w = [sp[i + 6] - sp[i], sp[i + 7] - sp[i + 1], sp[i + 8] - sp[i + 2]];
      const fx = u[1] * w[2] - u[2] * w[1], fz = u[0] * w[1] - u[1] * w[0];
      if (fx * sn[i] + fz * sn[i + 2] < -1e-9) inward++;
    }
    ctx.ok("a slab's sides face out", inward === 0, `${inward} inward`);
    ctx.ok("a slab's sides are the terrain's own cliff program, with a ghost and a fade spliced in",
      GL.PROPS_PROGRAMS.slabSide.fragment.includes("paintedSide(") && /attribute vec2 aSlab/.test(GL.PROPS_PROGRAMS.slabSide.vertex)
      && GL.PROPS_PROGRAMS.slabSide.fragment.trim().endsWith("}"));

    // roofs fade
    const gable = gmStates.find((s) => s.shape === "gable");
    const gb = [...L.buckets.values()].find((b) => b.states.some((s) => s.id === gable.id));
    const gi = gb.states.findIndex((s) => s.id === gable.id);
    L.castersDirty = false;
    L.setRoofFade(new Map([[gable.id, 0.2]]));
    ctx.ok("a faded roof: its fade written, its shadow gone, the shadow map asked to redraw",
      Math.abs(gb.fade.getX(gi) - 0.2) < 1e-6 && !castsAtOf(gb, gi) && L.castersDirty);
    L.setRoofFade(new Map([[gable.id, 1]]));
    ctx.ok("a roof faded back casts again", castsAtOf(gb, gi) && gb.fade.getX(gi) === 1);
    ctx.ok("every roof program and the card dither on a fade (no blending, no second program)",
      /iFade/.test(GL.PROP_VERT) && /propDither\(\) >= vFade/.test(GL.PROP_FRAG) && /uCardFade/.test(GL.PROP_CARD_FRAG));

    // the level of detail
    L.pxWorld = 1 / 6;
    let n = 0;
    const lods = [];
    while (L.frame(0, 0.1, null, { detail: 1 }) && n++ < 400) lods.push(L.common.uPropLod.value);
    ctx.ok("relief fades with the zoom, damped (no pop), and settles to ask for nothing",
      lods.length > 3 && lods.every((v, i) => !i || v <= lods[i - 1]) && L.common.uPropLod.value === 0 && !L.frame(0, 0.1, null, { detail: 1 }), `${lods.length} frames`);
    L.pxWorld = 1 / 60;
    ctx.ok("zooming back in asks for frames until the relief is back", L.frame(0, 0.1, null, { detail: 1 }) && L.common.uPropLod.value > 0);
    L.dispose();
  } finally {
    console.warn = warn0;
    M.setModelLoader(null);
  }

  // ── the brazier ──
  ctx.ok("a brazier is iron legs and a bowl with glowing coals in it",
    SHAPE_PARTS.brazier.some((q) => q.part === "coals") && SHAPE_PARTS.brazier.some((q) => q.part === "iron") && SHAPE_DEFAULTS_OK(P));
  ctx.ok("a brazier burns whatever it is called (a warm light in it is a fire)",
    !!fireProp({ x: 2, z: 2 }, [{ shape: "brazier", x: 2, y: 2, w: 0.6, d: 0.6, label: "" }]) && !fireProp({ x: 2, z: 2 }, [{ shape: "bowl", x: 2, y: 2, label: "" }]));
}

function castsAtOf(b, i) {
  return b.caster.instanceMatrix.array.subarray(i * 16, i * 16 + 16).some((v, k) => k !== 15 && v !== 0);
}

function SHAPE_DEFAULTS_OK(P) {
  const d = P.SHAPE_DEFAULTS.brazier;
  return d.mat === "metal" && d.solid === true;
}
