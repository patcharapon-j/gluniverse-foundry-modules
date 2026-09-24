/**
 * Performance — the GM's texture audit sheet.
 *
 * Lists what the viewed scene asks the GPU to hold, heaviest first, with the
 * one piece of advice that applies to each. Built in a memoised factory for
 * the same reason as the floor sheet: nothing that the check tool reaches may
 * touch `foundry` at module scope.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { FEATURE_ID } from "./constants.mjs";
import { audit } from "./audit-rules.mjs";

let _app = null;

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);
}

/** Size of a source as the texture cache holds it, if it is loaded. */
function sizeOf(src) {
  try {
    const cached = foundry.canvas.TextureLoader.loader.getCache(src);
    const base = cached?.baseTexture ?? cached;
    const w = base?.realWidth ?? base?.width ?? 0;
    const h = base?.realHeight ?? base?.height ?? 0;
    const mipmaps = base?.mipmap !== undefined ? base.mipmap !== 0 : true;
    return { width: w, height: h, mipmaps };
  } catch {
    return { width: 0, height: 0, mipmaps: true };
  }
}

/** Every texture the viewed scene draws, by kind. */
function collect() {
  const scene = canvas?.scene;
  if (!scene) return [];
  const rows = [];
  const push = (src, kind) => { if (src) rows.push({ src, kind, ...sizeOf(src) }); };
  for (const lt of scene._configureLevelTextures?.() ?? []) push(lt.src, "level");
  for (const tile of scene.tiles) push(tile.texture?.src, "tile");
  for (const token of scene.tokens) push(token.texture?.src, "token");
  for (const note of scene.notes) push(note.texture?.src, "other");
  for (const drawing of scene.drawings) push(drawing.texture, "other");
  return rows;
}

export function AuditApp() {
  if (_app) return _app;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _app = class PerfAuditApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "glperf-audit",
      classes: ["glperf", "glperf-audit-app"],
      window: { title: "GLPERF.audit.title", icon: "fa-solid fa-images", resizable: true },
      position: { width: 760, height: 620 },
      actions: { refresh: PerfAuditApp.prototype._onRefresh },
    };

    static PARTS = {
      main: { template: `modules/${SUITE_ID}/templates/${FEATURE_ID}/audit.hbs`, scrollable: [".glperf-audit-list"] },
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const result = audit(collect());
      return {
        ...context,
        scene: canvas?.scene?.name ?? "—",
        total: mb(result.total),
        count: result.rows.length,
        flagged: result.flagged,
        rows: result.rows.map((r) => ({
          src: r.src,
          name: decodeURIComponent(r.src.split("/").pop() ?? r.src),
          kind: L(`GLPERF.audit.kind.${r.kind}`),
          size: r.width ? `${r.width}×${r.height}` : "—",
          mb: mb(r.bytes),
          uses: r.uses,
          flags: r.flags.map((f) => ({ id: f, label: L(`GLPERF.audit.flag.${f}`), advice: L(`GLPERF.audit.advice.${f}`) })),
        })),
      };
    }

    _onRefresh() {
      this.render();
    }
  };

  return _app;
}
