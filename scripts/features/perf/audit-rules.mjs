/**
 * Performance — texture audit rules.
 *
 * Pure: the check tool drives it with synthetic rows.
 *
 * A scene-change hitch is very often not a code problem at all. An 8K PNG
 * background is ~256 MB of video memory once uploaded (four bytes a pixel,
 * plus a third again for mipmaps) and has to be decoded on the main thread
 * before any of it reaches the GPU; no module can make that cheap, but a GM can
 * re-export it in a minute once somebody tells them which file it is. That is
 * all this does: it measures, flags, and advises. It converts nothing.
 */

export const AUDIT = Object.freeze({
  /** Past this edge a texture is costly everywhere and refused by some GPUs. */
  hugeEdge: 8192,
  /** Past this edge it is worth asking whether the detail is ever seen. */
  largeEdge: 4096,
  /** Token art is drawn at a few hundred pixels; past this it is wasted. */
  tokenEdge: 1024,
  /** Uncompressed formats past this estimated size should be WebP or KTX2. */
  heavyBytes: 32 * 1024 * 1024,
});

const COMPRESSED = new Set(["webp", "avif", "ktx2", "basis"]);
const VIDEO = new Set(["webm", "mp4", "m4v", "ogv", "ogg"]);

export const extOf = (src) => String(src ?? "").split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";

/** Estimated GPU bytes for a texture: RGBA8, plus a third for mipmaps. */
export function estimateBytes(width, height, mipmaps = true) {
  if (!(width > 0 && height > 0)) return 0;
  return Math.round(width * height * 4 * (mipmaps ? 4 / 3 : 1));
}

/**
 * Flag one texture.
 * @param {{ src: string, kind: "level"|"tile"|"token"|"other", width: number, height: number, mipmaps?: boolean }} row
 * @returns {string[]} flag ids (i18n: GLPERF.audit.flag.<id>)
 */
export function flagsFor(row) {
  const flags = [];
  const edge = Math.max(row.width || 0, row.height || 0);
  const ext = extOf(row.src);
  const bytes = estimateBytes(row.width, row.height, row.mipmaps !== false);
  if (VIDEO.has(ext)) flags.push("video");
  if (edge > AUDIT.hugeEdge) flags.push("huge");
  else if (edge > AUDIT.largeEdge) flags.push("large");
  if (row.kind === "token" && edge > AUDIT.tokenEdge) flags.push("tokenArt");
  if (!VIDEO.has(ext) && !COMPRESSED.has(ext) && bytes > AUDIT.heavyBytes) flags.push("uncompressed");
  if (!edge) flags.push("unloaded");
  return flags;
}

/**
 * Audit a list of rows: dedupe by source, flag, sort heaviest first.
 * @param {{ src: string, kind: string, width: number, height: number, mipmaps?: boolean }[]} rows
 */
export function audit(rows) {
  const bySrc = new Map();
  for (const row of rows) {
    if (!row?.src) continue;
    const prev = bySrc.get(row.src);
    if (prev) { prev.uses += 1; continue; }
    bySrc.set(row.src, { ...row, uses: 1 });
  }
  const out = [...bySrc.values()].map((r) => {
    const bytes = estimateBytes(r.width, r.height, r.mipmaps !== false);
    return { ...r, ext: extOf(r.src), bytes, flags: flagsFor(r) };
  });
  out.sort((a, b) => b.bytes - a.bytes);
  const total = out.reduce((a, r) => a + r.bytes, 0);
  return { rows: out, total, flagged: out.filter((r) => r.flags.length).length };
}

export const FLAGS = Object.freeze(["video", "huge", "large", "tokenArt", "uncompressed", "unloaded"]);
