/**
 * Where the odds sit on a targeting line. Pure: no `game`, no `canvas`, no DOM.
 * The badge layer and the preview page both place through here, so what the
 * preview shows is where the badge lands at the table.
 *
 * The tag rides the line itself, a little short of the head, and the line runs
 * through it the way a measurement runs through its figure on a drawing. The
 * path is `stream-targets`' own geometry for the same two tokens, so the tag is
 * on the line the canvas draws, not on a lookalike; with the line feature off,
 * the tag sits where that line would be.
 *
 * The plate opens off the tag on the OUTSIDE of the arc (the bow side), which
 * is the one side the body never curves back across. Everything is clamped
 * inside the viewport, and tags that would cover each other slide back along
 * their own lines until they do not.
 */

import { HEAD_LENGTH_SQUARES, createPath, lineGeometry, pointAt } from "../stream-targets/targeting/target-geometry.js";

/** Shares of the line's length a tag tries, in order: just short of the head first. */
export const TAG_SHARES = Object.freeze([0.72, 0.6, 0.5, 0.82, 0.4, 0.3]);
/** The tag never sits closer to the head than the head plus this much clear line, in grid squares. */
export const TAG_HEAD_CLEARANCE_SQUARES = 0.3;
/** Screen gap between the tag and the plate that opens off it, and the viewport margin. */
export const PLATE_GAP_PX = 6;
export const VIEW_MARGIN_PX = 8;

/**
 * The line's path between two tokens, in world units, into a reusable buffer.
 * @param {{from:{x,y}, to:{x,y}, sourceSize:number, targetSize:number, gridSize:number}} input
 */
export function linePath(input, path = createPath()) {
  return lineGeometry(input, path);
}

/**
 * The point at `share` of the line (pulled back clear of the head) and the
 * bow-side unit normal there, in world units.
 */
export function tagAnchor(path, share, gridSize, out = { x: 0, y: 0, nx: 0, ny: 1, arc: 0 }) {
  const length = path.length;
  const clear = (HEAD_LENGTH_SQUARES + TAG_HEAD_CLEARANCE_SQUARES) * gridSize;
  // A short melee arch has no room "short of the head": its apex is the place.
  const arc = length > clear * 2 ? Math.min(length * share, length - clear) : length / 2;
  const p = pointAt(path, arc);
  // The bow side is left of travel in screen space, the side the arc bulges to.
  const chordX = path.xs[path.xs.length - 1] - path.xs[0];
  const chordY = path.ys[path.ys.length - 1] - path.ys[0];
  const midX = (path.xs[0] + path.xs[path.xs.length - 1]) / 2;
  const midY = (path.ys[0] + path.ys[path.ys.length - 1]) / 2;
  // Which way the arc bulges: from the chord's midpoint towards the curve's middle.
  const mid = pointAt(path, length / 2);
  let nx = mid.x - midX;
  let ny = mid.y - midY;
  let n = Math.hypot(nx, ny);
  if (n < 1e-6) {
    nx = -chordY;
    ny = chordX;
    n = Math.hypot(nx, ny) || 1;
  }
  out.x = p.x;
  out.y = p.y;
  out.nx = nx / n;
  out.ny = ny / n;
  out.arc = arc;
  return out;
}

/**
 * The tag's rule takes the line's own colour. `linesChanged` announces it as a
 * 0xRRGGBB number (Diorama reads the same payload); anything else is no colour.
 */
export function lineCss(color) {
  if (Number.isFinite(color)) return `#${(Math.max(0, Math.min(0xffffff, Math.round(color))) >>> 0).toString(16).padStart(6, "0")}`;
  if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  return null;
}

/**
 * A straight stand-in for the line between two screen points, for when the
 * board is under Diorama's 3D view and the 2D path names the wrong spot. The
 * bow side is left of travel, the side the canvas line bows to.
 */
export function straightAnchor(from, to, share, out = { x: 0, y: 0, nx: 0, ny: 1 }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  out.x = from.x + dx * share;
  out.y = from.y + dy * share;
  out.nx = -dy / d;
  out.ny = dx / d;
  return out;
}

const overlaps = (a, b, pad = 2) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Choose each tag's spot. `items` are in priority order (the acting creature's
 * lines first); each carries `at(share) → {x, y}` (screen px of the tag's
 * centre at that share) and its tag size. The first share whose box is clear
 * of every tag already placed wins; if none is, the first share stands.
 *
 * @param {Array<{at:(share:number)=>{x:number,y:number}, w:number, h:number}>} items
 * @returns {Array<{x:number, y:number, share:number}>}  tag centres, same order
 */
export function placeTags(items, shares = TAG_SHARES) {
  const placed = [];
  const out = [];
  for (const item of items) {
    let pick = null;
    for (const share of shares) {
      const c = item.at(share);
      if (!c) continue;
      const box = { x: c.x - item.w / 2, y: c.y - item.h / 2, w: item.w, h: item.h };
      if (!pick) pick = { ...c, share, box };
      if (!placed.some((b) => overlaps(b, box))) {
        pick = { ...c, share, box };
        break;
      }
    }
    if (!pick) {
      out.push(null);
      continue;
    }
    placed.push(pick.box);
    out.push({ x: pick.x, y: pick.y, share: pick.share });
  }
  return out;
}

/**
 * Place every line's tag and, where it is open, its plate, in priority order
 * (the hovered line and the acting creature's first).
 *
 * Tags go first, all of them: a tag is the one thing every line carries, so an
 * open plate is never allowed to bury another line's. Each slides along its
 * own line until it is clear of the tags already placed (placeTags). Then each
 * open plate tries the bow side of its arc, the other side, and the four
 * compass sides, and takes the first spot clear of every tag, every plate
 * already placed and the `obstacles` (the tokens' screen boxes); with none
 * clear, the spot that covers least.
 *
 * @param {Array<{at:(share:number)=>{x,y,nx,ny}|null, w:number, h:number, plate?:{w:number,h:number}|null}>} items
 * @param {{w:number, h:number}} viewport
 * @param {{obstacles?: Array<{x,y,w,h}>, shares?: number[]}} [opts]
 * @returns {Array<{tag:{x,y}, plate:{x,y}|null, side:string|null, share:number}|null>}  same order as `items`
 */
export function placeLines(items, viewport, { obstacles = [], shares = TAG_SHARES } = {}) {
  const spots = placeTags(items, shares);
  const tags = spots.map((spot, i) => {
    if (!spot) return null;
    const r = placeBadge({ tag: spot, normal: { x: 0, y: 1 }, tagSize: { w: items[i].w, h: items[i].h }, viewport });
    return { x: r.tag.x, y: r.tag.y, w: items[i].w, h: items[i].h };
  });
  const plates = [];
  return items.map((item, i) => {
    const spot = spots[i];
    if (!spot) return null;
    const plateSize = item.plate ?? null;
    const a = item.at(spot.share) ?? { nx: 0, ny: 1 };
    if (!plateSize) {
      const r = placeBadge({ tag: spot, normal: { x: a.nx, y: a.ny }, tagSize: { w: item.w, h: item.h }, viewport });
      return { tag: r.tag, plate: null, side: null, share: spot.share };
    }
    const normals = [{ x: a.nx, y: a.ny }, { x: -a.nx, y: -a.ny }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];
    // The first clear side wins. With none clear, the side that covers least,
    // where covering a tag costs most (it is the only reading that line has),
    // then another plate, then a token.
    let best = null;
    for (const normal of normals) {
      const r = placeBadge({ tag: spot, normal, tagSize: { w: item.w, h: item.h }, plateSize, viewport });
      const box = { x: r.plate.x, y: r.plate.y, w: plateSize.w, h: plateSize.h };
      const cost = 100 * tags.filter((t, j) => j !== i && t && overlaps(t, box)).length
        + 10 * plates.filter((p) => overlaps(p, box)).length
        + obstacles.filter((o) => overlaps(o, box, 0)).length;
      if (!best || cost < best.cost) best = { r, box, cost };
      if (cost === 0) break;
    }
    plates.push(best.box);
    return { tag: best.r.tag, plate: best.r.plate, side: best.r.side, share: spot.share };
  });
}

/**
 * The tag's top-left and the plate's top-left, in screen px.
 *
 * @param {{
 *   tag: {x:number, y:number},          // the tag's centre
 *   normal: {x:number, y:number},       // bow-side unit normal (screen)
 *   tagSize: {w:number, h:number},
 *   plateSize?: {w:number, h:number}|null,
 *   viewport: {w:number, h:number},
 * }} spec
 */
export function placeBadge({ tag, normal, tagSize, plateSize = null, viewport }) {
  const m = VIEW_MARGIN_PX;
  const tagAt = {
    x: Math.round(clamp(tag.x - tagSize.w / 2, m, viewport.w - tagSize.w - m)),
    y: Math.round(clamp(tag.y - tagSize.h / 2, m, viewport.h - tagSize.h - m)),
  };
  if (!plateSize) return { tag: tagAt, plate: null, side: null };
  const cy = tagAt.y + tagSize.h / 2;
  const g = PLATE_GAP_PX;
  let x;
  let y;
  let side;
  if (Math.abs(normal.x) > Math.abs(normal.y) * 1.4) {
    // Bulging sideways: the plate opens beside the tag.
    side = normal.x > 0 ? "right" : "left";
    x = side === "right" ? tagAt.x + tagSize.w + g : tagAt.x - g - plateSize.w;
    y = cy - plateSize.h / 2;
  } else {
    // Bulging up or down: the plate hangs off the tag, flush with the tag's edge on the side the arc leans to.
    side = normal.y >= 0 ? "below" : "above";
    x = normal.x >= 0 ? tagAt.x : tagAt.x + tagSize.w - plateSize.w;
    y = side === "below" ? tagAt.y + tagSize.h + g : tagAt.y - g - plateSize.h;
  }
  // No room on the bow side: flip to the other one before clamping.
  if (side === "below" && y + plateSize.h > viewport.h - m) { side = "above"; y = tagAt.y - g - plateSize.h; }
  else if (side === "above" && y < m) { side = "below"; y = tagAt.y + tagSize.h + g; }
  else if (side === "right" && x + plateSize.w > viewport.w - m) { side = "left"; x = tagAt.x - g - plateSize.w; }
  else if (side === "left" && x < m) { side = "right"; x = tagAt.x + tagSize.w + g; }
  return {
    tag: tagAt,
    plate: {
      x: Math.round(clamp(x, m, viewport.w - plateSize.w - m)),
      y: Math.round(clamp(y, m, viewport.h - plateSize.h - m)),
    },
    side,
  };
}
