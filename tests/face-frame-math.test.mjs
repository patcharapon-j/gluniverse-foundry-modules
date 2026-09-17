import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compactResult, coverPlacement, cropFor, headBox, isFaceEntry, projectCover, viewBoxStyle
} from "../scripts/core/face-frame-math.mjs";

const subject = (width, height, box, hasAlpha = false, touches) => ({
  kind: "subject",
  image: { width, height, hasAlpha, ...(touches && { touches }) },
  candidates: [{ box, confidence: 0.9, tier: "detector", source: "anime" }, { box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.1, tier: "detector", source: "x" }],
  eyeLineY: 0,
  focal: { x: 0, y: 0 }
});

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

describe("compactResult", () => {
  test("keeps the chosen head as image fractions and round-trips through headBox", () => {
    const entry = compactResult(subject(1000, 1500, { x: 400, y: 150, width: 200, height: 240 }));
    assert.deepEqual(entry, { k: "s", w: 1000, h: 1500, b: [0.4, 0.1, 0.2, 0.16], tier: "detector" });
    assert.ok(isFaceEntry(entry));
    assert.deepEqual(headBox(entry), { x: 400, y: 150, width: 200, height: 240 });
  });

  test("records transparency and the edges the art touches", () => {
    const touches = { top: false, right: false, bottom: true, left: false };
    const entry = compactResult(subject(512, 512, { x: 200, y: 50, width: 100, height: 100 }, true, touches));
    assert.equal(entry.a, 1);
    assert.equal(entry.t, "b");
  });

  test("framed and empty results carry no box and give no crop", () => {
    const framed = compactResult({ kind: "already-framed", image: { width: 400, height: 400, hasAlpha: true } });
    const none = compactResult({ kind: "none", image: { width: 400, height: 600, hasAlpha: false } });
    assert.equal(framed.k, "f");
    assert.equal(none.k, "n");
    assert.ok(isFaceEntry(framed) && isFaceEntry(none));
    assert.equal(cropFor(framed, "portrait-bust"), null);
    assert.equal(cropFor(none, "portrait-bust"), null);
  });

  test("rejects malformed stored entries", () => {
    assert.ok(!isFaceEntry(null));
    assert.ok(!isFaceEntry({ k: "s", w: 10, h: 10 }));
    assert.ok(!isFaceEntry({ k: "s", w: 10, h: 10, b: [0, 0, "x", 1] }));
    assert.ok(!isFaceEntry({ k: "q", w: 10, h: 10 }));
  });
});

describe("cropFor", () => {
  test("puts the eye line where the frame asks and stays inside opaque art", () => {
    const entry = compactResult(subject(1000, 1500, { x: 400, y: 300, width: 200, height: 300 }));
    const crop = cropFor(entry, { aspect: 3 / 4, headRatio: 0.3, eyeLine: 0.3 });
    near(crop.width / crop.height, 0.75, 1e-6, "aspect");
    near(300 / crop.height, 0.3, 1e-6, "head ratio");
    near(300 + 300 * 0.55 - crop.y, crop.height * 0.3, 1e-6, "eye line");
    near(crop.x + crop.width / 2, 500, 1e-6, "centred on the head");
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1000 && crop.y + crop.height <= 1500);
  });

  test("never pads, even for transparent art", () => {
    const entry = compactResult(subject(600, 600, { x: 250, y: 10, width: 100, height: 100 }, true, { top: false, right: false, bottom: true, left: false }));
    const crop = cropFor(entry, "token-square");
    assert.ok(crop.y >= 0, "shifted down rather than padded above the head");
  });
});

describe("coverPlacement", () => {
  const cases = [
    ["tall art in a wide strip", 1000, 1500, { x: 300, y: 200, width: 400, height: 123.4 }, 188, 58],
    ["tall art in the active card", 1000, 1500, { x: 250, y: 100, width: 500, height: 415 }, 200, 166],
    ["wide art in a 3:4 card", 1600, 900, { x: 900, y: 100, width: 300, height: 400 }, 170, 226.67],
    ["crop spanning the full drawn width", 800, 1200, { x: 0, y: 300, width: 800, height: 1066.67 }, 150, 200]
  ];

  for (const [name, W, H, crop, bw, bh] of cases) {
    test(`maps the crop onto the box: ${name}`, () => {
      const placement = coverPlacement(crop, W, H, bw, bh);
      const tl = projectCover(placement, crop.x, crop.y, W, H, bw, bh);
      const br = projectCover(placement, crop.x + crop.width, crop.y + crop.height, W, H, bw, bh);
      near((tl.x + br.x) / 2, bw / 2, 0.5, "centre x");
      near((tl.y + br.y) / 2, bh / 2, 0.5, "centre y");
      near(br.x - tl.x, bw, 1, "width fills the box");
      assert.ok(placement.scale >= 1);
    });
  }

  test("without zoom the crop is centred as far as the cover fit allows", () => {
    const W = 1000, H = 1500;
    const placement = coverPlacement({ x: 400, y: 566.67, width: 200, height: 266.67 }, W, H, 3, 4, { zoom: false });
    assert.equal(placement.scale, 1);
    assert.equal(placement.x, 50, "the width already fits: nothing to move");
    const centre = projectCover(placement, 500, 700, W, H, 3, 4);
    near(centre.y, 2, 0.01, "the head's row is centred");
    const top = coverPlacement({ x: 400, y: 0, width: 200, height: 266.67 }, W, H, 3, 4, { zoom: false });
    assert.equal(top.y, 0, "clamped at the top edge");
  });

  test("a crop looser than the cover fit is not shrunk below cover", () => {
    const placement = coverPlacement({ x: 0, y: 0, width: 1000, height: 1500 }, 1000, 1500, 188, 58);
    assert.equal(placement.scale, 1);
  });
});

describe("viewBoxStyle", () => {
  test("insets are the crop's distances from each image edge", () => {
    const style = viewBoxStyle({ x: 100, y: 50, width: 200, height: 200 }, 400, 500);
    assert.equal(style.objectViewBox, "inset(10% 25% 50% 25%)");
  });
});
