/**
 * Hexcrawl renderer — text: the two-tier region labels and the landmark
 * badges' icons and captions.
 *
 * Text is sized in world units (a fraction of R) and rasterised at the
 * resolution it lands on screen at (zoom × devicePixelRatio), which the
 * renderer re-applies when the zoom settles far enough from the last raster.
 */

import { neighbors } from "../hex-math.mjs";
import { GEO } from "./style.mjs";
import { diamond, landmarkSlots } from "./geom.mjs";

const PIP = "◆"; // ◆
const DOT = "·"; // ·
export const UNKNOWN_NAME = "???";

/**
 * Where each region's label goes, and what it says, for this viewer.
 * A region is labelled only from hexes where the viewer may see its name, at
 * the one nearest the centroid of those (preferring a hex with no landmark).
 */
export function regionLabels(ctx, views, terrainName) {
  const groups = new Map();
  for (const [k, v] of views) {
    // A region's SHAPE may be visible without its name (mask field "region"):
    // only hexes that show the name may place — or even count toward — a label.
    if (!v.regionId || !(v.name || v.nameUnknown)) continue;
    let g = groups.get(v.regionId);
    if (!g) groups.set(v.regionId, (g = []));
    g.push([k, v]);
  }
  const out = [];
  const placed = []; // label centres already taken, to keep two labels' boxes apart
  // Biggest regions choose first: they have the most room to give way in.
  const order = [...groups].sort((a, b) => b[1].length - a[1].length);
  for (const [id, members] of order) {
    const region = ctx.map.regions[id];
    if (!region?.name) continue;
    let sx = 0, sy = 0;
    const pts = members.map(([k]) => ctx.adapter.center(k));
    for (const p of pts) { sx += p.x; sy += p.y; }
    const cx = sx / pts.length, cy = sy / pts.length;
    let best = null, bd = Infinity;
    members.forEach(([k, v], n) => {
      // A label spills into its neighbours, so keep it off landmark captions too.
      const crowd = neighbors(ctx.adapter, k).some((x) => views.get(x)?.landmarks?.length);
      const R = ctx.R;
      const clash = placed.some((q) => Math.abs(q.x - pts[n].x) < R * 3.4 && Math.abs(q.y - pts[n].y) < R * 1.1);
      const d = (pts[n].x - cx) ** 2 + (pts[n].y - cy) ** 2
        + (v.landmarks?.length ? R ** 2 * 64 : 0) + (crowd ? R ** 2 * 6 : 0) + (clash ? R ** 2 * 40 : 0);
      if (d < bd) { bd = d; best = k; }
    });
    // Tier two: only what this viewer has seen somewhere in the region.
    const terrainSeen = members.some(([, v]) => v.terrain);
    const ratingSeen = members.some(([, v]) => v.rating != null);
    const parts = [];
    const tid = region.t;
    if (tid && terrainSeen) parts.push(String(terrainName(tid) ?? tid).toUpperCase());
    if (region.rt && ratingSeen) parts.push(PIP.repeat(region.rt));
    placed.push(ctx.adapter.center(best));
    // Players see "???" until the GM marks the name known (viewFor: nameUnknown).
    const known = members.some(([, v]) => v.name);
    out.push({ id, key: best, name: known ? region.name.toUpperCase() : UNKNOWN_NAME, sub: parts.join(`  ${DOT}  `) });
  }
  return out;
}

function text(PIXI, str, style, res) {
  const t = new PIXI.Text(str, new PIXI.TextStyle(style));
  t.resolution = res;
  t.anchor.set(0.5, 0.5);
  return t;
}

export function makeRegionLabel(PIXI, ctx, info, res) {
  const R = ctx.R;
  const c = ctx.adapter.center(info.key);
  const box = new PIXI.Container();
  box.position.set(c.x, c.y);
  const nameSize = GEO.labelName * R;
  const name = text(PIXI, info.name, {
    fontFamily: ctx.fontFamily, fontSize: nameSize, fontWeight: "600",
    fill: ctx.colors.css.text, letterSpacing: nameSize * 0.17,
    stroke: ctx.colors.css.ink0, strokeThickness: nameSize * 0.32, lineJoin: "round",
  }, res);
  box.addChild(name);
  if (info.sub) {
    const subSize = GEO.labelSub * R;
    const sub = text(PIXI, info.sub, {
      fontFamily: ctx.fontFamily, fontSize: subSize, fontWeight: "500",
      fill: ctx.colors.css.textDim, letterSpacing: subSize * 0.14,
      stroke: ctx.colors.css.ink0, strokeThickness: subSize * 0.34, lineJoin: "round",
    }, res);
    name.y = -subSize * 0.62;
    sub.y = nameSize * 0.62;
    box.addChild(sub);
  }
  // Keep a long name from spilling far past its hex: shrink, never wrap.
  const maxW = R * 3.2;
  if (box.width > maxW) box.scale.set(maxW / box.width);
  return box;
}

/**
 * The icons (and captions) that sit in the landmark diamonds drawn by the
 * static layer. Image landmarks load asynchronously; `alive()` says whether
 * the node is still wanted when the texture arrives.
 */
export function makeLandmarkNode(PIXI, ctx, key, landmarks, res, { resolveIcon, loadTexture, alive }) {
  const R = ctx.R;
  const c = ctx.adapter.center(key);
  const node = new PIXI.Container();
  node.position.set(c.x, c.y);
  const n = landmarks.length;
  const s = GEO.lmBadge * R * (n >= 3 ? 0.82 : 1);
  const slots = landmarkSlots(n);
  landmarks.forEach((lm, i) => {
    const x = slots[i].x * R, y = (GEO.lmBadgeY + slots[i].y) * R;
    const icon = lm.icon ? resolveIcon?.(lm.icon) : null;
    if (lm.img && loadTexture) {
      Promise.resolve(loadTexture(lm.img)).then((tex) => {
        if (!tex || !alive() || node.destroyed) return;
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5);
        const side = s * 1.45;
        sp.scale.set(side / Math.max(1, Math.min(tex.width, tex.height)));
        sp.position.set(x, y);
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff, 1);
        mask.drawPolygon(diamond(x, y, s * 0.86));
        mask.endFill();
        sp.mask = mask;
        node.addChild(mask, sp);
      }).catch(() => {});
    } else if (icon?.char) {
      const t = text(PIXI, icon.char, {
        fontFamily: icon.fontFamily, fontWeight: String(icon.fontWeight ?? "900"),
        fontSize: GEO.labelIcon * R * (n >= 3 ? 0.82 : 1), fill: ctx.colors.css.warnLift,
      }, res);
      t.position.set(x, y);
      node.addChild(t);
    }
  });
  const labels = landmarks.map((l) => l.label).filter(Boolean);
  if (labels.length) {
    const size = GEO.labelLmName * R;
    const str = n === 1 ? labels[0].toUpperCase() : labels.map((l) => l.toUpperCase()).join("\n");
    const t = text(PIXI, str, {
      fontFamily: ctx.fontFamily, fontSize: size, fontWeight: "600", align: "center",
      fill: ctx.colors.css.text, letterSpacing: size * 0.16, lineHeight: size * 1.18,
      stroke: ctx.colors.css.ink0, strokeThickness: size * 0.36, lineJoin: "round",
    }, res);
    t.anchor.set(0.5, 0);
    t.y = (GEO.lmLabelY + (n >= 3 ? 0.02 : 0)) * R;
    const maxW = R * 2.4;
    if (t.width > maxW) t.scale.set(maxW / t.width);
    node.addChild(t);
  }
  return node;
}

/** Every PIXI.Text under a container (for re-rasterising at a new resolution). */
export function eachText(root, fn) {
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (o.destroyed) continue;
    if (typeof o.text === "string" && "resolution" in o && o.style) fn(o);
    if (o.children) for (const ch of o.children) stack.push(ch);
  }
}
