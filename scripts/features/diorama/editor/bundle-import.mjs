/**
 * Diorama — bringing a Map Maker Diorama Bundle (docs/DIORAMA_BUNDLE.md) into
 * a scene: fetch its manifest and layout from a folder Foundry serves, point
 * every model at the folder, set the Level's 3D ground and import the layout.
 *
 * The reading is pure (terrain/bundle.mjs); this is the half that fetches and
 * writes. The editor's Import bundle button uses `loadBundle` and keeps the
 * result as a draft; the API's `importBundle` writes at once.
 */

import { MANIFEST, joinBundlePath, readManifest, resolveBundleLayout, sceneWarnings } from "../terrain/bundle.mjs";
import { GroundStore } from "../terrain/ground.mjs";
import { gridOf, supportsScene } from "../terrain/store.mjs";
import { importLayout } from "./layout-import.mjs";

/** A URL the browser can fetch for a path in Foundry's data (route prefix included). */
function fetchUrl(path) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/")) return path;
  return globalThis.foundry?.utils?.getRoute?.(path) ?? path;
}

async function fetchJson(path) {
  const res = await fetch(fetchUrl(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`.trim());
  try { return await res.json(); } catch (e) { throw new Error(`${path}: not valid JSON (${e.message})`); }
}

/**
 * Read a bundle folder. Nothing is written.
 * @param {string} folder  a folder path as Foundry serves it (`worlds/<world>/maps/concourse-3-diorama`)
 * @param {{scene?: Scene}} [o]  the scene it is meant for, for the size warnings
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[], manifest?:object, layout?:object, ground?:string}>}
 */
export async function loadBundle(folder, { scene = null } = {}) {
  const dir = String(folder ?? "").trim().replace(/[\\/]+$/, "");
  if (!dir) return { ok: false, errors: ["No bundle folder was given."], warnings: [] };
  let raw;
  try { raw = await fetchJson(joinBundlePath(dir, MANIFEST)); } catch (e) {
    return { ok: false, errors: [`Could not read ${MANIFEST} in ${dir}: ${e.message}`], warnings: [] };
  }
  const m = readManifest(raw);
  if (!m.ok) return { ok: false, errors: m.errors, warnings: m.warnings };
  const warnings = [...m.warnings];
  let layout;
  try { layout = await fetchJson(joinBundlePath(dir, m.manifest.layout)); } catch (e) {
    return { ok: false, errors: [`Could not read the layout: ${e.message}`], warnings };
  }
  const resolved = resolveBundleLayout(layout, dir);
  if (resolved.errors.length) return { ok: false, errors: resolved.errors, warnings };
  if (scene) {
    const g = gridOf(scene);
    const map = { cols: Math.round(g.sceneRect.width / g.size), rows: Math.round(g.sceneRect.height / g.size) };
    warnings.push(...sceneWarnings(m.manifest, map, g.size));
  }
  return { ok: true, errors: [], warnings, manifest: m.manifest, layout: resolved.layout, ground: joinBundlePath(dir, m.manifest.ground) };
}

/**
 * Import a bundle into a scene at once (GM only): its layout as importLayout
 * writes one (terrain, props, tokens), then the Level's 3D ground. Nothing is
 * written while there is an error.
 * @param {string} folder
 * @param {{scene?: Scene, tokens?: boolean}} [o]
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[], ground?:string, props?:number|null, moved?:number, missing?:string[]}>}
 */
export async function importBundle(folder, { scene = globalThis.canvas?.scene, tokens = true } = {}) {
  if (!game.user?.isGM) return { ok: false, errors: ["Only a GM can import a bundle."], warnings: [] };
  if (!scene || !supportsScene(scene)) return { ok: false, errors: ["Diorama works on square grids only."], warnings: [] };
  const b = await loadBundle(folder, { scene });
  if (!b.ok) return b;
  const res = await importLayout(b.layout, { scene, tokens });
  if (!res.ok) return { ...res, warnings: [...b.warnings, ...res.warnings] };
  await GroundStore.write(scene, b.ground);
  return { ...res, warnings: [...b.warnings, ...res.warnings], ground: b.ground };
}
