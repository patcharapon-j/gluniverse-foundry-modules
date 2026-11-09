/**
 * Contributed Control Room sections: where each lands, and the feature command
 * and status slots a sibling feature (Diorama's 2D / 3D switch) rides.
 *
 * A section ordered below 0 leads its tab, above the tab's own sections; the
 * rest follow them. The template draws `lead.<tab>` first, so a section that
 * decides what the audience sees (Board view) is not buried under the fold.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  registerPanelSection, unregisterPanelSection, renderPanelSectionsByTab, renderPanelSections,
  registerStreamCommand, runStreamCommand, registerStatusField, readStatusFields,
} from "../scripts/features/stream/extensions.mjs";
import { sectionHtml, roomState, viewModeOf } from "../scripts/features/diorama/stream-bridge.mjs";

describe("panel sections", () => {
  test("a negative order leads its tab, the rest follow", async () => {
    registerPanelSection({ id: "t-lead", tab: "shot", order: -10, render: () => "<lead>" });
    registerPanelSection({ id: "t-tail", tab: "shot", order: 5, render: () => "<tail>" });
    try {
      const by = await renderPanelSectionsByTab();
      assert.equal(by.lead.shot, "<lead>");
      assert.equal(by.shot, "<tail>");
      assert.equal(by.lead.overlay, "");
      // the flat rendering keeps the lead ahead of its tab
      const flat = await renderPanelSections();
      assert.ok(flat.indexOf("<lead>") < flat.indexOf("<tail>"));
    } finally {
      unregisterPanelSection("t-lead");
      unregisterPanelSection("t-tail");
    }
  });
});

describe("feature commands and status", () => {
  test("a registered command runs with its args; an unknown one does nothing", async () => {
    let got = null;
    registerStreamCommand("t.cmd", (args) => { got = args; });
    await runStreamCommand("t.cmd", { mode: "3d" });
    assert.deepEqual(got, { mode: "3d" });
    await assert.doesNotReject(runStreamCommand("t.nothing", {}));
  });

  test("status fields are read into the report", () => {
    registerStatusField("t-field", () => ({ view: "3d" }));
    assert.deepEqual(readStatusFields()["t-field"], { view: "3d" });
  });
});

describe("Diorama's Board view", () => {
  const t = (k) => k;
  test("only 2d and 3d are modes", () => {
    assert.equal(viewModeOf({ mode: "3D" }), "3d");
    assert.equal(viewModeOf({ mode: "2d" }), "2d");
    assert.equal(viewModeOf({ mode: "4d" }), null);
    assert.equal(viewModeOf(null), null);
  });

  test("the pressed button is what the capture reports", () => {
    const html = sectionHtml(roomState({ active: true, features: { diorama: { view: "3d", offered: true } } }), t);
    assert.match(html, /data-action="gldio-stream-3d" aria-pressed="true"/);
    assert.match(html, /data-action="gldio-stream-2d" aria-pressed="false"/);
    assert.doesNotMatch(html, /disabled/);
  });

  test("off air, or a scene the view cannot show, the switch is disabled with its reason", () => {
    const off = sectionHtml(roomState({ active: false }), t);
    assert.match(off, /disabled/);
    assert.match(off, /GLDIO\.stream\.hintOffAir/);
    const no = sectionHtml(roomState({ active: true, features: { diorama: { view: "2d", offered: false } } }), t);
    assert.match(no, /disabled/);
    assert.match(no, /GLDIO\.stream\.hintUnsupported/);
  });
});
