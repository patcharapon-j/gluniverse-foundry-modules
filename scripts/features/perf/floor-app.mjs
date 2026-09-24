/**
 * Performance — the GM's floor sheet.
 *
 * One world maximum, then a row per user that can replace it (in either
 * direction) and mark the user as a capture client. It is also where the GM
 * sees each player's last report, because the question this sheet answers is
 * "who needs a lower floor", and that is a question about their numbers.
 *
 * Built in a memoised factory, not at module scope: `tiers.mjs` and friends are
 * loaded by the check tool under plain Node, where `foundry` does not exist,
 * and anything that reaches this file transitively would take the tool down.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { FEATURE_ID, SETTINGS } from "./constants.mjs";
import { TIERS } from "./tiers.mjs";
import { onReportReceived, receivedReports, requestReport, saveReport } from "./report.mjs";

let _app = null;

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

function readFloor() {
  let f = {};
  try { f = game.settings.get(SUITE_ID, SETTINGS.floor) ?? {}; } catch { f = {}; }
  return { max: TIERS.includes(f.max) ? f.max : TIERS[0], users: { ...(f.users ?? {}) } };
}

function summary(report) {
  if (!report) return null;
  const b = report.benchmark;
  const fps = b?.fps ?? report.fps;
  const p95 = b?.interval?.p95 ?? report.interval?.p95;
  return {
    fps: fps ?? "—",
    p95: p95 ?? "—",
    tier: report.tier ? L(`GLPERF.tier.${report.tier}`) : "—",
    gpu: report.gpu ?? "",
    when: new Date(report.at).toLocaleTimeString(),
    bench: !!b,
  };
}

export function FloorApp() {
  if (_app) return _app;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _app = class PerfFloorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "glperf-floor",
      classes: ["glperf", "glperf-floor-app"],
      tag: "form",
      window: { title: "GLPERF.floor.title", icon: "fa-solid fa-gauge-high", resizable: true },
      position: { width: 720, height: "auto" },
      form: { handler: PerfFloorApp.#save, submitOnChange: false, closeOnSubmit: true },
      actions: {
        request: PerfFloorApp.prototype._onRequest,
        requestAll: PerfFloorApp.prototype._onRequestAll,
        download: PerfFloorApp.prototype._onDownload,
      },
    };

    static PARTS = {
      main: { template: `modules/${SUITE_ID}/templates/${FEATURE_ID}/floor.hbs` },
    };

    #unsubscribe = null;

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const floor = readFloor();
      const reports = receivedReports();
      const tiers = TIERS.map((id) => ({ id, label: L(`GLPERF.tier.${id}`) }));
      const users = game.users.contents
        .slice()
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map((u) => {
          const row = floor.users[u.id] ?? {};
          return {
            id: u.id,
            name: u.name,
            isGM: u.isGM,
            active: u.active,
            max: TIERS.includes(row.max) ? row.max : "",
            capture: !!row.capture,
            report: summary(reports.get(u.id)),
          };
        });
      return { ...context, max: floor.max, tiers, users };
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.#unsubscribe = onReportReceived(() => this.render());
    }

    _onClose(options) {
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      super._onClose?.(options);
    }

    /**
     * Save.
     *
     * The form's names are dotted (`users.<id>.max`) because Foundry's form
     * parser only builds nested objects from dotted names; a flat name would
     * submit happily and store a floor with no users in it. A row that says
     * nothing — world default and not a capture client — is not stored, so an
     * untouched sheet writes the same object as a sheet never opened.
     */
    static async #save(event, form, formData) {
      const data = foundry.utils.expandObject(formData.object);
      const users = {};
      for (const [id, row] of Object.entries(data.users ?? {})) {
        if (!game.users.has(id)) continue;
        const max = TIERS.includes(row?.max) ? row.max : null;
        const capture = !!row?.capture;
        if (max || capture) users[id] = { max, capture };
      }
      const next = { max: TIERS.includes(data.max) ? data.max : TIERS[0], users };
      try {
        await game.settings.set(SUITE_ID, SETTINGS.floor, next);
      } catch (e) {
        warn("perf | could not save the floor", e);
      }
    }

    _onRequest(event, target) {
      const id = target.closest("[data-user-id]")?.dataset.userId;
      if (id) requestReport(id);
    }

    _onRequestAll() {
      requestReport(null);
    }

    _onDownload(event, target) {
      const id = target.closest("[data-user-id]")?.dataset.userId;
      const report = id ? receivedReports().get(id) : null;
      if (report) saveReport(report);
    }
  };

  return _app;
}
