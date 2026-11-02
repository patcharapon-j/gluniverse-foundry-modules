/**
 * Diorama check — the seams with other features that the 3D view redraws:
 * the targeting lines (stream-targets) and the effect halo (PF2e conditions and
 * effects). Each one fails silently: a line drawn where 2D draws none, a line
 * missing where 2D draws one, a halo that drops the effects PF2e Effects Halo
 * shows, or a setting the view never re-reads.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIO = "scripts/features/diorama";

export default async function (ctx) {
  const read = (rel) => readFileSync(join(ctx.root, rel), "utf8");

  /* ── Targeting lines ── */
  globalThis.Hooks ??= { _h: new Map(), on(n, f) { (this._h.get(n) ?? this._h.set(n, []).get(n)).push(f); return f; }, callAll(n, ...a) { for (const f of this._h.get(n) ?? []) f(...a); } };
  const lines = await import(ctx.url(`${DIO}/integrations/target-lines.mjs`));
  const { TARGETS_HOOKS } = await import(ctx.url("scripts/features/stream-targets/settings.js"));

  const s = lines.sanitizeLines([
    { sourceId: "a", targetId: "b", color: 0xff4a52 },
    { sourceId: "a", targetId: "b", color: 0x00ff00 },
    { sourceId: "a", targetId: "a" },
    { sourceId: "", targetId: "b" },
    null,
    { sourceId: "c", targetId: "d" },
  ]);
  ctx.ok("lines: duplicates, self-lines and blanks are dropped", s.length === 2, JSON.stringify(s));
  ctx.ok("lines: a 0xRRGGBB colour becomes 0..1 rgb",
    Math.abs(s[0].color[0] - 1) < 1e-6 && Math.abs(s[0].color[1] - 0x4a / 255) < 1e-6 && Math.abs(s[0].color[2] - 0x52 / 255) < 1e-6,
    JSON.stringify(s[0].color));
  ctx.ok("lines: an unset colour falls back to the accent, never black",
    s[1].color.length === 3 && s[1].color.some((c) => c > 0.2), JSON.stringify(s[1].color));
  ctx.ok("lines: only lines with both ends on the board are drawn",
    lines.linksOn(s, new Set(["a", "b", "c"])).length === 1);

  lines.watchTargetLines();
  lines.watchTargetLines(); // wired once, however often init runs
  let heard = 0;
  const off = lines.onLinesChanged(() => heard++);
  Hooks.callAll(TARGETS_HOOKS.linesChanged, [{ sourceId: "x", targetId: "y", color: 0x112233 }]);
  ctx.ok("lines: the announcement is remembered for a view opened later",
    lines.currentLines().length === 1 && lines.currentLines()[0].sourceId === "x");
  ctx.ok("lines: one announcement wakes the view once", heard === 1, `heard ${heard}`);
  off();
  Hooks.callAll(TARGETS_HOOKS.linesChanged, []);
  ctx.ok("lines: a closed view stops listening", heard === 1 && lines.currentLines().length === 0);

  const emitter = read("scripts/features/stream-targets/targeting/target-lines.js");
  ctx.ok("lines: stream-targets announces each line's own colour",
    /linesChanged,[\s\S]{0,200}color:\s*style\?\.color/.test(emitter));
  const overlay = read(`${DIO}/view/overlay.mjs`);
  ctx.ok("lines: the overlay listens and unsubscribes on close",
    /onLinesChanged\(/.test(overlay) && /S\.unLines\?\.\(\)/.test(overlay));
  ctx.ok("lines: the overlay hands the renderer only on-board lines",
    /setLinks\??\.?\(linksOn\(currentLines\(\), S\.tokenIds\)\)/.test(overlay));
  ctx.ok("lines: the listener is wired at init, not when the view opens",
    /watchTargetLines\(\)/.test(read(`${DIO}/main.mjs`)));

  /* ── Effect halo ── */
  const { conditionsFor, MAX_HALO, MAX_ICONS } = await import(ctx.url(`${DIO}/integrations/conditions.mjs`));
  const item = (o) => ({ ...o, slug: o.slug, system: { slug: o.slug, ...(o.system ?? {}) } });
  const actor = {
    items: [
      item({ type: "condition", slug: "frightened", img: "fr.webp", system: { value: { value: 2 }, references: { parent: null }, active: true } }),
      item({ type: "effect", slug: "bless", img: "bless.webp", system: { tokenIcon: { show: true } } }),
      item({ type: "effect", slug: "hidden-fx", img: "hid.webp", system: { tokenIcon: { show: false } } }),
      item({ type: "effect", slug: "rage", img: "rage.webp", badge: { value: 3 }, system: { tokenIcon: { show: true } } }),
    ],
  };
  actor.itemTypes = { condition: actor.items.filter((i) => i.type === "condition"), effect: actor.items.filter((i) => i.type === "effect") };
  const token = { actor };
  const plate = conditionsFor(token, "pf2e");
  const halo = conditionsFor(token, "pf2e", { halo: true });
  const icons = (l) => l.map((c) => c.icon);
  ctx.ok("halo: PF2e effects shown on the token join the ring",
    icons(halo).includes("bless.webp") && icons(halo).includes("rage.webp"), JSON.stringify(halo));
  ctx.ok("halo: an effect hidden from the token stays hidden", !icons(halo).includes("hid.webp"));
  ctx.ok("halo: an effect's badge value is carried", halo.find((c) => c.icon === "rage.webp")?.value === 3);
  ctx.ok("plate: the head plate keeps conditions only", !icons(plate).includes("bless.webp"), JSON.stringify(plate));
  ctx.ok("halo: room for more icons than the plate", MAX_HALO > MAX_ICONS);

  const snap = read(`${DIO}/view/snapshot.mjs`);
  ctx.ok("halo: TokenState says which layout to draw", /halo:\s*!!halo/.test(snap) && /conditionsFor\(token, systemId, \{ halo \}\)/.test(snap));
  ctx.ok("halo: the overlay re-reads tokens when the layout setting changes",
    /SETTINGS\.effects\}`\) \{ mark\("tokens"\)/.test(overlay) && /halo:\s*haloLayout\(\)/.test(overlay));
  const constants = read(`${DIO}/constants.mjs`);
  const index = read(`${DIO}/index.mjs`);
  const lang = JSON.parse(read("lang/diorama.en.json"));
  ctx.ok("halo: the layout setting is registered", /effects:\s*"dio\.effects"/.test(constants) && /SETTINGS\.effects,/.test(index));
  for (const k of ["name", "hint", "halo", "plate"]) {
    ctx.ok(`halo: GLDIO.settings.effects.${k} resolves`, typeof lang[`GLDIO.settings.effects.${k}`] === "string");
  }
}
