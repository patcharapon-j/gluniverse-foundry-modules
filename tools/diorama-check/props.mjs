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
  const STORED = ["id", "shape", "x", "y", "w", "d", "h", "elev", "rot", "mat", "tint", "solid", "hidden", "label"];
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
  const { buildPropGeometries, SHAPE_PARTS, PROP_MATERIAL_FACTORIES, PROP_MATERIAL_PROGRAM, PropsLayer } = await import(ctx.url("scripts/features/diorama/render/props.mjs"));
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
  const noParts = PROP_SHAPES.filter((s) => !SHAPE_PARTS[s] || (s !== "card" && !SHAPE_PARTS[s].length));
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
  const casting = [...layer.buckets.values()].reduce((n, b) => n + b.caster.count, 0);
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

  // A frame must allocate nothing: no `new`, no literal arrays or objects in frame().
  const rsrc = readFileSync(join(ctx.root, "scripts/features/diorama/render/props.mjs"), "utf8");
  const body = rsrc.slice(rsrc.indexOf("  frame(_t"), rsrc.indexOf("  /** The nearest BLOCKING"));
  ctx.ok("PropsLayer.frame allocates nothing", body.length > 0 && !/\bnew\s|\[\s*\]|=\s*\{|\.\.\./.test(body.replace(/\/\/.*$/gm, "")));

  // ── strings ──
  const lang = JSON.parse(readFileSync(join(ctx.root, "lang/diorama-props.en.json"), "utf8"));
  ctx.ok("props lang keys are flat and namespaced", Object.keys(lang).every((k) => k.startsWith("GLDIO.props.") && typeof lang[k] === "string"));
  const dyn = [...PROP_SHAPES.map((s) => `GLDIO.props.shape.${s}`), ...PROP_MATERIALS.map((m) => `GLDIO.props.mat.${m}`), "GLDIO.props.mode.terrain", "GLDIO.props.mode.props"];
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
