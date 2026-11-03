/**
 * Map Maker Diorama Bundles (terrain/bundle.mjs, terrain/ground.mjs,
 * editor/bundle-import.mjs, the model textures in render/props-models.mjs).
 *
 * Everything here fails silently. A model src joined to the wrong folder is a
 * GM-only hatched box and nothing for a player; a ground flag the view does
 * not watch keeps the old art until a reload; a ground that misses the undo
 * history comes back after Undo; a pixel-art texture left on its mipmaps
 * blurs into mush a few squares away; an emissive texture dropped in the bake
 * is a rune that never glows. The fixture bundle (tools/diorama-bundle-fixture.mjs,
 * tests/fixtures/diorama-bundle) is read through the real GLTFLoader.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = "tests/fixtures/diorama-bundle";

export default async function check(ctx) {
  const B = await import(ctx.url("scripts/features/diorama/terrain/bundle.mjs"));
  const G = await import(ctx.url("scripts/features/diorama/terrain/ground.mjs"));
  const { compileLayout } = await import(ctx.url("scripts/features/diorama/terrain/layout.mjs"));
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { FLAG_GROUND } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const { SUITE_ID } = await import(ctx.url("scripts/core/const.mjs"));
  const file = (rel) => readFileSync(join(ctx.root, FIXTURE, rel));
  const json = (rel) => JSON.parse(file(rel).toString("utf8"));

  // ── paths ──
  const J = B.joinBundlePath;
  ctx.ok("a bundle path joins to its folder", J("worlds/w/maps/c3-diorama", "props/a.glb") === "worlds/w/maps/c3-diorama/props/a.glb"
    && J("worlds/w/maps/c3-diorama/", "./props/a.glb") === "worlds/w/maps/c3-diorama/props/a.glb"
    && J("worlds\\w\\b", "props\\a.glb") === "worlds/w/b/props/a.glb"
    && J("", "ground.webp") === "ground.webp", J("worlds/w/maps/c3-diorama/", "./props/a.glb"));
  ctx.ok("a bundle path may step back inside the folder, never out of it",
    J("b", "props/../ground.webp") === "b/ground.webp" && J("b", "../x.glb") === null && J("b", "props/../../x.glb") === null);
  ctx.ok("a rooted path (URL, data URI, absolute) is kept as it is",
    J("b", "https://cdn.example/a.glb") === "https://cdn.example/a.glb" && J("b", "/abs/a.glb") === "/abs/a.glb" && J("b", "data:model/gltf-binary;base64,AA") === "data:model/gltf-binary;base64,AA");
  ctx.ok("an empty or missing path joins to nothing", J("b", "") === null && J("b", "  ") === null && J("b", undefined) === null && J("b", ".") === null);

  // ── the manifest ──
  const m = B.readManifest(json("manifest.json"));
  ctx.ok("the fixture manifest reads cleanly", m.ok && !m.warnings.length && m.manifest.ground === "ground.png" && m.manifest.layout === "layout.json"
    && m.manifest.gridPx === 32 && m.manifest.squares.join() === "8,6" && m.manifest.image.join() === "256,192", JSON.stringify(m));
  const bad = (raw) => B.readManifest(raw);
  ctx.ok("a manifest of another version is refused, naming the version", !bad({ ...json("manifest.json"), version: 2 }).ok
    && bad({ ...json("manifest.json"), version: 2 }).errors[0].includes("version 2"));
  ctx.ok("a manifest without a ground or a layout is refused", !bad({ version: 1, layout: "l.json" }).ok && !bad({ version: 1, ground: "g.webp" }).ok);
  ctx.ok("a manifest that climbs out of its folder is refused", !bad({ version: 1, ground: "../g.webp", layout: "l.json" }).ok);
  ctx.ok("not an object is refused", !bad(null).ok && !bad([]).ok && !bad("x").ok);
  const odd = bad({ version: 1, ground: "g.webp", layout: "l.json", gridPx: 100, squares: [10, 10], image: [900, 1000] });
  ctx.ok("sizes that disagree are a warning, not a refusal", odd.ok && odd.warnings.length === 1, odd.warnings.join(" | "));
  ctx.ok("a bundle sized for another map warns about the stretch", B.sceneWarnings(m.manifest, { cols: 8, rows: 6 }, 32).length === 0
    && B.sceneWarnings(m.manifest, { cols: 9, rows: 6 }, 32).length === 1 && B.sceneWarnings(m.manifest, { cols: 8, rows: 6 }, 100).length === 1);

  // ── the layout ──
  const rawLayout = json("layout.json");
  const before = JSON.stringify(rawLayout);
  const rl = B.resolveBundleLayout(rawLayout, "worlds/w/maps/yard-diorama");
  ctx.ok("every model src is joined to the bundle folder", !rl.errors.length
    && rl.layout.props.every((p) => p.src.startsWith("worlds/w/maps/yard-diorama/props/")), JSON.stringify(rl.layout.props.map((p) => p.src)));
  ctx.ok("the contract's x, y place a model at [row, col] in map squares", rl.layout.props[0].at.join() === "1.5,2.5"
    && !("x" in rl.layout.props[0]) && !("y" in rl.layout.props[0]));
  ctx.ok("resolving leaves the layout it was given untouched", JSON.stringify(rawLayout) === before);
  const keepAt = B.resolveBundleLayout({ props: [{ shape: "model", src: "a.glb", at: [1, 2], x: 9, y: 9 }, { shape: "box", at: [0, 0], src: "z" }] }, "b").layout.props;
  ctx.ok("an explicit at wins over x, y, and only models are touched", keepAt[0].at.join() === "1,2" && keepAt[1].src === "z");
  const escaping = B.resolveBundleLayout({ props: [{ shape: "model", src: "../../secret.glb", label: "Bad" }] }, "b");
  ctx.ok("a model src that climbs out of the bundle is refused by name", escaping.errors.length === 1 && escaping.errors[0].includes("\"Bad\""), escaping.errors.join(" | "));

  const grid = { cols: 8, rows: 6, distance: 5, offset: { i: 0, j: 0 }, map: { cols: 8, rows: 6 } };
  const compiled = compileLayout(rl.layout, grid);
  ctx.ok("the fixture layout compiles with no warning", !!compiled.terrain && !compiled.errors.length && !compiled.warnings.length,
    [...compiled.errors, ...compiled.warnings].join(" | "));
  const [crate, pillar] = compiled.props ?? [];
  ctx.ok("a bundle model lands where the 2D art drew it, at its height", crate?.shape === "model" && crate.x === 2.5 && crate.y === 1.5
    && crate.w === 1 && crate.d === 1 && crate.h === 1 && crate.solid === true && crate.label === "Crate"
    && pillar?.h === 2 && pillar.rot === 30 && pillar.src === "worlds/w/maps/yard-diorama/props/rune-pillar.glb", JSON.stringify(compiled.props));
  // padded canvas: the importer adds the offset, the bundle never does
  const padded = compileLayout(rl.layout, { ...grid, cols: 12, rows: 10, offset: { i: 2, j: 2 } });
  ctx.ok("on a padded scene the model moves with the map rect", padded.props?.[0].x === 4.5 && padded.props?.[0].y === 3.5);

  // ── the ground flag ──
  const flagScene = (levels, extra = {}) => ({ flags: { [SUITE_ID]: { dio: { ground: { levels } } } }, ...extra });
  ctx.ok("the ground flag is dio.ground", FLAG_GROUND === "dio.ground");
  ctx.ok("a scene with no ground flag draws its background", G.GroundStore.read({ flags: {} }) === null && G.groundArtSrc({ flags: {} }, null, "bg.webp") === "bg.webp");
  ctx.ok("a scene's ground is read for its Level", G.GroundStore.read(flagScene({ default: "b/ground.webp" })) === "b/ground.webp"
    && G.groundArtSrc(flagScene({ default: "b/ground.webp" }), null, "bg.webp") === "b/ground.webp");
  const two = flagScene({ L1: "one/ground.webp" }, {
    levels: [{ id: "L1", elevation: { bottom: 0, top: 10 } }, { id: "L2", elevation: { bottom: 10, top: 20 } }], initialLevel: "L1",
  });
  ctx.ok("each Level keeps its own ground; one without draws its background", G.GroundStore.read(two, "L1") === "one/ground.webp"
    && G.GroundStore.read(two, "L2") === null && G.groundArtSrc(two, "L2", "two.webp") === "two.webp");
  ctx.ok("an unusable ground is ignored", G.GroundStore.read(flagScene({ default: "" })) === null && G.GroundStore.read(flagScene({ default: 7 })) === null
    && G.normalizeGroundSrc("x".repeat(G.GROUND_SRC_MAX + 1)) === null && G.normalizeGroundSrc(" a.webp ") === "a.webp");
  const set = G.groundUpdate({ flags: {} }, "b/ground.webp");
  const cleared = G.groundUpdate({ flags: {} }, null);
  ctx.ok("a write sets one Level's entry; a clear deletes it", set[`flags.${SUITE_ID}.dio.ground.levels.default`] === "b/ground.webp"
    && Object.keys(cleared)[0] === `flags.${SUITE_ID}.dio.ground.levels.-=default`, JSON.stringify({ set, cleared }));
  const T = G.GroundStore.touched;
  ctx.ok("the view hears a ground change in every shape Foundry sends it",
    T({ flags: { [SUITE_ID]: { "dio.ground": {} } } }) && T({ flags: { [SUITE_ID]: { "dio.ground.levels.L1": "x" } } })
    && T({ flags: { [SUITE_ID]: { dio: { ground: { levels: { L1: "x" } } } } } }) && T({ flags: { [SUITE_ID]: { dio: { "-=ground": null } } } })
    && !T({ flags: { [SUITE_ID]: { dio: { props: {} } } } }) && !T({ name: "x" }));
  const overlay = readFileSync(join(ctx.root, "scripts/features/diorama/view/overlay.mjs"), "utf8");
  const levelView = readFileSync(join(ctx.root, "scripts/features/diorama/view/level-view.mjs"), "utf8");
  const preview = readFileSync(join(ctx.root, "scripts/features/diorama/editor/preview.mjs"), "utf8");
  ctx.ok("the 3D view, the floors below and the editor preview draw the 3D ground",
    /groundArtSrc\(S\.scene/.test(overlay) && /GroundStore\.touched\(changes\)/.test(overlay)
    && /groundArtSrc\(scene, l\.id/.test(levelView) && /session\.ground \?\?/.test(preview));
  const sample = readFileSync(join(ctx.root, "scripts/features/diorama/editor/sample.mjs"), "utf8");
  ctx.ok("auto setup still samples the full map art, never the 3D ground", !/ground\.mjs|GroundStore|groundArtSrc/.test(sample));

  // ── the editor draft ──
  const { EditorSession } = await import(ctx.url("scripts/features/diorama/editor/session.mjs"));
  const S = new EditorSession({ terrain: Terrain.blank(8, 6), grid: { size: 32, cols: 8, rows: 6, distance: 5, units: "ft" }, walls: [], props: [], ground: null });
  const heard = [];
  S.on((k) => heard.push(k));
  S.replace(compiled.terrain, "bundle", { props: compiled.props, ground: "worlds/w/maps/yard-diorama/ground.png" });
  ctx.ok("a bundle lands as one undo step: terrain, models and ground", S.history.done.length === 1 && S.props.length === 2
    && S.ground === "worlds/w/maps/yard-diorama/ground.png" && heard.includes("ground") && S.dirty);
  S.undo();
  ctx.ok("undo takes the ground back with the models", S.ground === null && S.props.length === 0);
  S.redo();
  ctx.ok("redo brings both back", S.ground === "worlds/w/maps/yard-diorama/ground.png" && S.props.length === 2);
  S.saved();
  ctx.ok("a save is the new baseline, ground included", !S.dirty && S.history.done.length === 0);
  S.setGround(null);
  ctx.ok("clearing the ground is its own undoable step", S.ground === null && S.dirty && S.history.done.length === 1);
  S.undo();
  ctx.ok("…and undoes", S.ground === "worlds/w/maps/yard-diorama/ground.png" && !S.dirty);
  ctx.ok("setting the same ground again commits nothing", S.setGround("worlds/w/maps/yard-diorama/ground.png") === false);
  const plain = new EditorSession({ terrain: Terrain.blank(8, 6), grid: { size: 32, cols: 8, rows: 6, distance: 5, units: "ft" }, ground: "saved.webp" });
  plain.replace(Terrain.blank(8, 6), "layout", { props: [] });
  ctx.ok("a plain layout import keeps the saved ground", plain.ground === "saved.webp");

  // ── import, end to end, against a fake world ──
  await importEndToEnd(ctx);

  // ── models from a bundle: the real GLTFLoader on the fixture ──
  await modelsCheck(ctx, file);
}

/** A scene that records its updates and applies them the way Foundry's dotted keys do (v13 operators). */
function fakeScene({ size = 32, cols = 8, rows = 6 } = {}) {
  const flags = {};
  const updates = [];
  const apply = (path, value) => {
    const keys = path.split(".").slice(1);   // past "flags"
    let o = flags;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    const last = keys[keys.length - 1];
    if (last.startsWith("-=")) delete o[last.slice(2)];
    else o[last.replace(/^==/, "")] = value;
  };
  return {
    id: "fake", name: "Fake",
    grid: { type: 1, size, distance: 5, units: "ft" },
    dimensions: { size, distance: 5, width: cols * size, height: rows * size, columns: cols, rows, sceneRect: { x: 0, y: 0, width: cols * size, height: rows * size } },
    flags,
    getFlag(scope, key) { return key.split(".").reduce((o, k) => o?.[k], flags[scope]); },
    async update(upd) { updates.push(upd); for (const [k, v] of Object.entries(upd)) apply(k, JSON.parse(JSON.stringify(v))); },
    tokens: { get: () => null, find: () => null },
    updates,
  };
}

async function importEndToEnd(ctx) {
  const { importBundle, loadBundle } = await import(ctx.url("scripts/features/diorama/editor/bundle-import.mjs"));
  const { GroundStore } = await import(ctx.url("scripts/features/diorama/terrain/ground.mjs"));
  const { PropStore } = await import(ctx.url("scripts/features/diorama/terrain/props-store.mjs"));
  const { TerrainStore } = await import(ctx.url("scripts/features/diorama/terrain/store.mjs"));
  const had = { game: globalThis.game, fetch: globalThis.fetch };
  const folder = "worlds/w/maps/yard-diorama";
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(url);
    const rel = String(url).startsWith(folder + "/") ? String(url).slice(folder.length + 1) : null;
    let body = null;
    try { body = rel ? readFileSync(join(ctx.root, FIXTURE, rel)) : null; } catch { body = null; }
    return body ? { ok: true, status: 200, statusText: "OK", json: async () => JSON.parse(body.toString("utf8")) }
      : { ok: false, status: 404, statusText: "Not Found", json: async () => { throw new Error("404"); } };
  };
  try {
    globalThis.game = { user: { isGM: true }, settings: { get: () => { throw new Error("unregistered"); } } };
    const b = await loadBundle(folder + "/");
    ctx.ok("loadBundle reads the manifest, then the layout it names", b.ok && fetched[0] === `${folder}/manifest.json` && fetched[1] === `${folder}/layout.json`
      && b.ground === `${folder}/ground.png` && b.layout.props.every((p) => p.src.startsWith(folder + "/props/")), JSON.stringify({ fetched, errors: b.errors }));
    const missing = await loadBundle("worlds/w/maps/nowhere");
    ctx.ok("a folder with no manifest says so", !missing.ok && missing.errors[0].includes("manifest.json"), missing.errors.join(" | "));

    const scene = fakeScene();
    const res = await importBundle(folder, { scene });
    ctx.ok("importBundle writes terrain, models and the ground", res.ok && res.props === 2 && res.ground === `${folder}/ground.png`
      && TerrainStore.has(scene) && PropStore.read(scene).length === 2 && GroundStore.read(scene) === `${folder}/ground.png`, JSON.stringify(res));
    const stored = PropStore.read(scene);
    ctx.ok("the stored models point at the bundle's files", stored.every((p) => p.shape === "model" && p.src.startsWith(`${folder}/props/`)), JSON.stringify(stored.map((p) => p.src)));

    const other = fakeScene();
    const refused = await importBundle("worlds/w/maps/nowhere", { scene: other });
    ctx.ok("nothing is written while there is an error", !refused.ok && other.updates.length === 0);
    globalThis.game = { user: { isGM: false }, settings: { get: () => undefined } };
    const player = fakeScene();
    const denied = await importBundle(folder, { scene: player });
    ctx.ok("only a GM imports a bundle", !denied.ok && player.updates.length === 0);
    const hex = { ...fakeScene(), grid: { type: 2, size: 32 } };
    globalThis.game = { user: { isGM: true }, settings: { get: () => undefined } };
    ctx.ok("a hex scene is refused", !(await importBundle(folder, { scene: hex })).ok);
  } finally {
    if (had.game === undefined) delete globalThis.game; else globalThis.game = had.game;
    if (had.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = had.fetch;
  }

  const main = readFileSync(join(ctx.root, "scripts/features/diorama/main.mjs"), "utf8");
  const app = readFileSync(join(ctx.root, "scripts/features/diorama/editor/app.mjs"), "utf8");
  const hbs = readFileSync(join(ctx.root, "templates/diorama/editor.hbs"), "utf8");
  const lang = JSON.parse(readFileSync(join(ctx.root, "lang/diorama-editor.en.json"), "utf8"));
  ctx.ok("the API offers importBundle and setGround", /importBundle: \(folder, o\)/.test(main) && /setGround: \(src/.test(main));
  ctx.ok("the editor's Import bundle button and ground row are wired", /data-action="importBundle"/.test(hbs) && /importBundle: DioramaEditor\.#onImportBundle/.test(app)
    && /data-action="clearGround"/.test(hbs) && /clearGround: DioramaEditor\.#onClearGround/.test(app));
  ctx.ok("the editor saves the ground with the draft", /GroundStore\.write\(this\.scene, s\.ground, this\.levelId\)/.test(app) && /ground: GroundStore\.read\(scene, this\.levelId\)/.test(app));
  const keys = [...hbs.matchAll(/GLDIO\.editor\.(?:bundle|ground)\.[a-zA-Z]+/g), ...app.matchAll(/GLDIO\.editor\.(?:bundle|ground)\.[a-zA-Z]+/g)].map((x) => x[0]);
  const lost = [...new Set(keys)].filter((k) => !lang[k]);
  ctx.ok("every bundle and ground string has an entry", keys.length > 0 && lost.length === 0, lost.join(", "));
}

/**
 * The fixture's .glb files through the vendored GLTFLoader, as a browser runs
 * it: a stub <img> stands in for the decoder (Node has none), the rest is real.
 */
async function modelsCheck(ctx, file) {
  const THREE = await import(ctx.url("scripts/features/diorama/render/three.mjs"));
  const M = await import(ctx.url("scripts/features/diorama/render/props-models.mjs"));
  const { PROP_MATERIAL_FACTORIES } = await import(ctx.url("scripts/features/diorama/render/props.mjs"));
  const GL = await import(ctx.url("scripts/features/diorama/render/props-glsl.mjs"));
  const { GLTFLoader } = await import(ctx.url("scripts/vendor/three/addons/loaders/GLTFLoader.js"));
  const had = { document: globalThis.document, self: globalThis.self };
  globalThis.self ??= globalThis;
  globalThis.document = {
    createElementNS: () => {
      const on = {};
      return {
        width: 16, height: 32, naturalWidth: 16, naturalHeight: 32,
        addEventListener: (t, f) => { on[t] = f; }, removeEventListener: (t) => { delete on[t]; },
        set src(v) { this._src = v; queueMicrotask(() => on.load?.call(this)); }, get src() { return this._src; },
      };
    },
  };
  const parse = (bytes) => new Promise((ok, no) => {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    new GLTFLoader().parse(ab, "", (g) => ok(g), no);
  });
  try {
    const crate = M.bakeScene((await parse(file("props/crate.glb"))).scene);
    const pillar = M.bakeScene((await parse(file("props/rune-pillar.glb"))).scene);
    ctx.ok("a bundle box bakes at its native size, base on y = 0", crate.size.map((v) => +v.toFixed(4)).join() === "1,1,1"
      && pillar.size.map((v) => +v.toFixed(4)).join() === "1,2,1" && crate.parts.length === 1 && pillar.parts.length === 1, JSON.stringify([crate.size, pillar.size]));
    const crisp = (t) => !!t && t.magFilter === THREE.NearestFilter && t.minFilter === THREE.NearestFilter && t.generateMipmaps === false && t.colorSpace === THREE.NoColorSpace;
    ctx.ok("a NEAREST sampler keeps the texture crisp: nearest both ways, no mipmaps", crisp(crate.parts[0].map) && crisp(pillar.parts[0].map),
      JSON.stringify({ mag: crate.parts[0].map?.magFilter, min: crate.parts[0].map?.minFilter, mips: crate.parts[0].map?.generateMipmaps }));
    ctx.ok("the emissive texture survives the bake, crisp too", crisp(pillar.parts[0].emissiveMap) && pillar.parts[0].emissive.every((v) => Math.abs(v - 1) < 1e-6),
      JSON.stringify(pillar.parts[0].emissive));
    ctx.ok("a model with no emission glows with nothing", crate.parts[0].emissiveMap === null && crate.parts[0].emissive.join() === "0,0,0");

    // a linear-filtered texture (any other glTF) is left alone
    const soft = new THREE.Texture();
    M.prepareModelTexture(soft);
    ctx.ok("a texture that asks for linear filtering keeps its mipmaps", soft.magFilter === THREE.LinearFilter && soft.minFilter === THREE.LinearMipmapLinearFilter && soft.generateMipmaps === true);

    // an emissive factor with no texture is a flat glow; strength multiplies it
    const glowMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x808080, emissive: 0xff0000, emissiveIntensity: 2 }));
    const g = M.bakeScene(glowMesh);
    ctx.ok("an emissive factor alone glows, times its strength", g.parts[0].emissiveMap === null && g.parts[0].emissive[0] > 1 && g.parts[0].emissive[1] === 0, JSON.stringify(g.parts[0].emissive));

    const mat = PROP_MATERIAL_FACTORIES.model({}, { color: [1, 1, 1], map: pillar.parts[0].map, emissive: pillar.parts[0].emissive, emissiveMap: pillar.parts[0].emissiveMap });
    const u = mat.uniforms;
    ctx.ok("the model program receives the emission", u.uModelEmissiveMap.value === pillar.parts[0].emissiveMap && u.uModelHasEmissiveMap.value === 1
      && u.uModelEmissive.value.x === pillar.parts[0].emissive[0]);
    const declared = [...GL.PROPS_PROGRAMS.propModel.fragment.matchAll(/uniform\s+\w+\s+(uModel\w+)/g)].map((x) => x[1]);
    const unset = declared.filter((n) => !(n in u) || u[n].value === undefined);
    ctx.ok("every model uniform has a value", declared.includes("uModelEmissive") && unset.length === 0, unset.join(", "));
    const plainMat = PROP_MATERIAL_FACTORIES.model({}, {});
    ctx.ok("a model without emission adds nothing", plainMat.uniforms.uModelHasEmissiveMap.value === 0 && plainMat.uniforms.uModelEmissive.value.length() === 0);
    mat.dispose(); plainMat.dispose();
  } finally {
    if (had.document === undefined) delete globalThis.document; else globalThis.document = had.document;
    if (had.self === undefined) delete globalThis.self; else globalThis.self = had.self;
  }
}
