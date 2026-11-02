/**
 * Spellglass — the identity plate: the area's name, and its measurement
 * while the GM inspects it.
 *
 * A small ink slab with the suite's chamfer on its lower right, one bar of the
 * area's hot colour down its left edge, the name in paper and the measurement
 * in a dim mono line under it. It stands just above the top of the area, so it
 * names the effect without sitting on whoever is standing in the middle of it.
 * It is quiet on purpose: the area is the information, the plate only says
 * which spell it is.
 *
 * Pure: PIXI and the text are handed in, nothing here reads the world, and the
 * preview page draws this exact file.
 */

import { PALETTE } from "../../../core/theme.mjs";
import { INK } from "./look.mjs";

/** Bundled faces (styles/gl-fonts.css). A canvas reads a family by name. */
export const PLATE_FONTS = Object.freeze({
  title: "\"Google Sans Flex\", Oxanium, \"Segoe UI\", sans-serif",
  detail: "\"JetBrains Mono\", Consolas, monospace",
});

const hexInt = (hex) => Number.parseInt(String(hex).replace(/^#/, "").slice(0, 6), 16) || 0;
const PAPER = hexInt(PALETTE.text);
const DIM = hexInt(PALETTE.textDim);

/** Font size of the plate's name, in world pixels, for a grid square size. */
export function plateFontSize(grid) {
  return Math.min(20, Math.max(12, Math.round(grid * 0.15)));
}

function slab(PIXI, x, y, w, h, cut, tone, bar) {
  const g = new PIXI.Graphics();
  g.eventMode = "none";
  g.beginFill(INK, 0.84);
  g.drawPolygon([x, y, x + w, y, x + w, y + h - cut, x + w - cut, y + h, x, y + h]);
  g.endFill();
  g.lineStyle({ width: 1, color: PAPER, alpha: 0.14 });
  g.moveTo(x + bar, y + 0.5);
  g.lineTo(x + w, y + 0.5);
  g.lineStyle(0);
  g.beginFill(tone, 1);
  g.drawRect(x, y, bar, h);
  g.endFill();
  return g;
}

/**
 * Build a plate. The returned container's origin is the anchor point (the
 * top centre of the area); the plate stands above it.
 *
 *   title   the area's name ("" for none: the plate then shows only while
 *           inspected, and shows the measurement as its one line)
 *   detail  the measurement summary ("" for none)
 *   tone    "#rrggbb", the area's hot colour, for the bar
 *   grid    the scene's grid size in pixels
 */
export function buildPlate(PIXI, { title = "", detail = "", tone = "#d6e2ff", grid = 100, resolution = 2 } = {}) {
  const root = new PIXI.Container();
  root.eventMode = "none";
  const fs = plateFontSize(grid);
  const name = String(title ?? "").trim().toUpperCase();
  const summary = String(detail ?? "").trim();
  const toneInt = hexInt(tone);
  const bar = Math.max(2, Math.round(fs * 0.2));
  const padX = Math.round(fs * 0.75);
  const cut = Math.round(fs * 0.6);
  const gap = Math.round(fs * 0.55);
  const rowH = Math.round(fs * 1.9);
  const detailH = Math.round(fs * 1.45);

  const first = new PIXI.Text(name || summary, name
    ? { fontFamily: PLATE_FONTS.title, fontSize: fs, fontWeight: "650", letterSpacing: Math.max(1, Math.round(fs * 0.1)), fill: PAPER }
    : { fontFamily: PLATE_FONTS.detail, fontSize: Math.round(fs * 0.8), fontWeight: "500", letterSpacing: 1, fill: PAPER });
  first.resolution = resolution;
  const maxText = fs * 22;
  if (first.width > maxText) first.scale.set(maxText / first.width);
  const second = name && summary
    ? new PIXI.Text(summary, { fontFamily: PLATE_FONTS.detail, fontSize: Math.round(fs * 0.72), fontWeight: "500", letterSpacing: 1, fill: DIM })
    : null;
  if (second) second.resolution = resolution;

  const textW = Math.max(first.width, second?.width ?? 0);
  const w = Math.round(bar + padX * 2 + textW);
  const x = -Math.round(w / 2);
  const shut = { h: rowH, y: -gap - rowH };
  const open = { h: rowH + (second ? detailH : 0), y: -gap - rowH - (second ? detailH : 0) };
  const closed = slab(PIXI, x, shut.y, w, shut.h, cut, toneInt, bar);
  const expanded = second ? slab(PIXI, x, open.y, w, open.h, cut, toneInt, bar) : null;
  root.addChild(closed);
  if (expanded) root.addChild(expanded);

  first.anchor.set(0, 0.5);
  root.addChild(first);
  if (second) {
    second.anchor.set(0, 0.5);
    root.addChild(second);
  }

  root.glAoeDetail = second;
  root.glAoeSummary = summary;
  root.setInspected = (inspected) => {
    const showDetail = Boolean(second && inspected);
    if (!name) root.visible = Boolean(inspected && summary);
    closed.visible = !showDetail;
    if (expanded) expanded.visible = showDetail;
    const top = showDetail ? open.y : shut.y;
    first.position.set(x + bar + padX, Math.round(top + rowH / 2));
    if (second) {
      second.visible = showDetail;
      second.position.set(x + bar + padX, Math.round(top + rowH + detailH * 0.35));
    }
  };
  root.setInspected(false);
  return root;
}
