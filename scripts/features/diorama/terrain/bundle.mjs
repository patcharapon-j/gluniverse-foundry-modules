/**
 * Diorama — a Map Maker Diorama Bundle (docs/DIORAMA_BUNDLE.md), read. Pure.
 *
 * A bundle is a folder: `manifest.json`, a ground image (the map with its
 * standing props painted out), `props/<key>.glb` and a layout
 * (docs/DIORAMA_LAYOUT.md) with one `model` prop per standing prop, each `src`
 * relative to the folder. This module checks the manifest, joins paths to the
 * folder and rewrites the layout's model srcs; editor/bundle-import.mjs
 * fetches the files and writes the scene, and tools/diorama-preview.mjs
 * --bundle runs the same functions on disk.
 */

export const BUNDLE_VERSION = 1;
export const MANIFEST = "manifest.json";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const posInt = (v) => Number.isInteger(v) && v > 0;
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(posInt);

/** A path already rooted (a URL, a data URI, or an absolute path) is kept as it is. */
const ROOTED = /^([a-z][a-z0-9+.-]*:|\/)/i;

/**
 * `rel` joined to `folder`, with `.` and `..` segments resolved and Windows
 * separators turned to `/`. A rooted `rel` is returned unchanged. Returns null
 * for an empty path or one that climbs out of the folder.
 */
export function joinBundlePath(folder, rel) {
  if (typeof rel !== "string" || !rel.trim()) return null;
  const r = rel.trim().replaceAll("\\", "/");
  if (ROOTED.test(r)) return r;
  const base = String(folder ?? "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
  const out = [];
  for (const seg of r.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (!out.length) return null; out.pop(); continue; }
    out.push(seg);
  }
  if (!out.length) return null;
  return base ? `${base}/${out.join("/")}` : out.join("/");
}

/**
 * Check a parsed manifest.json against the v1 contract.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], manifest: null | {
 *   version: number, name: string, gridPx: number, squares: number[], image: number[], ground: string, layout: string } }}
 */
export function readManifest(raw) {
  const errors = [], warnings = [];
  if (!isObj(raw)) return { ok: false, errors: ["manifest.json is not a JSON object."], warnings, manifest: null };
  if (raw.version !== BUNDLE_VERSION) errors.push(`manifest.json: version ${JSON.stringify(raw.version)} is not supported (this Diorama reads version ${BUNDLE_VERSION}).`);
  const str = (k) => (typeof raw[k] === "string" && raw[k].trim() ? raw[k].trim() : null);
  const ground = str("ground"), layout = str("layout");
  if (!ground) errors.push("manifest.json: \"ground\" must name the ground image.");
  if (!layout) errors.push("manifest.json: \"layout\" must name the layout file.");
  for (const [k, v] of [["ground", ground], ["layout", layout]]) {
    if (v && joinBundlePath("", v) === null) errors.push(`manifest.json: "${k}" climbs out of the bundle folder.`);
  }
  if (!posInt(raw.gridPx)) warnings.push("manifest.json: \"gridPx\" is missing or not a whole number of pixels.");
  if (!pair(raw.squares)) warnings.push("manifest.json: \"squares\" should be [width, height] in squares.");
  if (!pair(raw.image)) warnings.push("manifest.json: \"image\" should be [width, height] in pixels.");
  if (posInt(raw.gridPx) && pair(raw.squares) && pair(raw.image)
    && (raw.squares[0] * raw.gridPx !== raw.image[0] || raw.squares[1] * raw.gridPx !== raw.image[1])) {
    warnings.push(`manifest.json: ${raw.squares.join("×")} squares at ${raw.gridPx} px is not the ${raw.image.join("×")} px image.`);
  }
  if (errors.length) return { ok: false, errors, warnings, manifest: null };
  return {
    ok: true, errors, warnings,
    manifest: {
      version: raw.version,
      name: typeof raw.name === "string" ? raw.name : "",
      gridPx: posInt(raw.gridPx) ? raw.gridPx : null,
      squares: pair(raw.squares) ? [...raw.squares] : null,
      image: pair(raw.image) ? [...raw.image] : null,
      ground, layout,
    },
  };
}

/**
 * Warnings for a bundle placed on a scene whose map is `map` squares at
 * `size` px. The ground is drawn over the scene rect whatever its size, so a
 * mismatch stretches it; it is said, not refused.
 * @param {{squares:number[]|null, gridPx:number|null}} manifest
 * @param {{cols:number, rows:number}} map  @param {number} size
 */
export function sceneWarnings(manifest, map, size) {
  const out = [];
  if (manifest?.squares && map && (manifest.squares[0] !== map.cols || manifest.squares[1] !== map.rows)) {
    out.push(`The bundle is ${manifest.squares.join("×")} squares and this scene's map is ${map.cols}×${map.rows}; the ground is stretched over the scene.`);
  }
  if (manifest?.gridPx && size && manifest.gridPx !== size) {
    out.push(`The bundle's grid is ${manifest.gridPx} px and this scene's is ${size} px; the ground still covers the scene rect.`);
  }
  return out;
}

/**
 * The layout with every `model` prop's `src` joined to the bundle folder (a
 * copy; the input is untouched). A src that cannot be joined is left as it is
 * and reported, and the layout compile then refuses it in its own words.
 *
 * The bundle contract names a model's place as `x`, `y`; a layout places a
 * prop with `at: [row, col]`. A model prop with no `at` and numeric `x`, `y`
 * is read as the footprint's centre in map squares (`x` the column, `y` the
 * row), the same frame as `at`.
 * @returns {{ layout: object, errors: string[] }}
 */
export function resolveBundleLayout(layout, folder) {
  if (!isObj(layout)) return { layout, errors: [] };
  const copy = structuredClone(layout);
  const errors = [];
  if (Array.isArray(copy.props)) {
    copy.props.forEach((p, k) => {
      if (!isObj(p) || p.shape !== "model") return;
      if (p.at === undefined && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        p.at = [p.y, p.x];
        delete p.x;
        delete p.y;
      }
      const joined = joinBundlePath(folder, p.src);
      if (joined) p.src = joined;
      else errors.push(`props[${k}]${p.label ? ` "${p.label}"` : ""}: its src ${JSON.stringify(p.src ?? null)} is not a path inside the bundle.`);
    });
  }
  return { layout: copy, errors };
}
