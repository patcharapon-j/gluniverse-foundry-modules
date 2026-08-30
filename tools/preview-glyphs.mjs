/**
 * Token conditions — the preview's stand-in glyph set.
 *
 * The shipped feature samples PF2e's own condition and effect art through
 * `item.img`, which a page outside Foundry has no access to. These are drawn to
 * the same brief the etch expects — one stroke weight on a 24-unit grid, white
 * on transparency — so the preview exercises the real lighting path rather than
 * a simplified one, and so a glyph that would not survive the bevel does not
 * survive it here either.
 *
 * Nothing in the module imports this. It exists for `tools/token-conditions-preview.mjs`.
 */

export const ICON_STROKE = 1.7;
export const ICONS = Object.freeze({
  "dying": [
    "M12 3a7.5 7.5 0 0 0-7.5 7.5v2.6l2 2V19h11v-3.9l2-2V10.5A7.5 7.5 0 0 0 12 3z",
    "M10.2 15.4v2M13.8 15.4v2",
    { fill: "M9.2 9.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM14.8 9.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z" },
  ],
  "wounded": [
    "M12 20.5S4 15.4 4 10.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 8 2.4c0 5-8 10.1-8 10.1z",
    "M12.6 8.6l-2 3.6 3 1.3-2 3.4",
  ],
  "doomed": [
    "M3.5 5h17L12 20.5z", "M12 9v3.6",
    { fill: "M12 14.8a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" },
  ],
  "persistent-damage": [
    "M12 2.6c3.3 4.3 5.4 5.9 5.4 9.9a5.4 5.4 0 0 1-10.8 0c0-1.9.9-3.2 2.1-4.3 0 2.1 1 3.1 2 3.1 0-3.1.5-6.1 1.3-8.7z",
  ],
  "frightened": [
    "M12 12a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17z", "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
    "M12 14a2.6 2 0 1 1 0 4 2.6 2 0 0 1 0-4z",
    { fill: "M9.2 8.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM14.8 8.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z" },
  ],
  "clumsy": [
    "M3.5 16.5c2.6-5.6 4.6 3.4 8-2.4s4.4 1.8 6.2-2.6", "M20.5 11.5l-.6 3.2-2.9-1", "M3 20.5h18",
  ],
  "enfeebled": ["M12 3.5v11.5", "M7 10.5l5 4.5 5-4.5", "M4.5 20h15"],
  "drained": ["M12 3.2s6.2 7.1 6.2 11a6.2 6.2 0 1 1-12.4 0c0-3.9 6.2-11 6.2-11z", "M9 14.4h6"],
  "stupefied": [
    "M12 12.3a1.9 1.9 0 1 1-1.7-1.9 4.4 4.4 0 1 1 4.1 4.6 6.9 6.9 0 1 1-6.6-8.5",
    "M18.5 4.5l2 .6-.6 2",
  ],
  "sickened": [
    "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
    "M7.6 8.8l2.4 2.4M10 8.8l-2.4 2.4M14 8.8l2.4 2.4M16.4 8.8L14 11.2",
    "M8 16.6q2-2.2 4 0t4 0",
  ],
  "slowed": [
    "M6 3.2h12M6 20.8h12",
    "M7.4 3.2c0 4.9 4.6 5.9 4.6 8.8s-4.6 3.9-4.6 8.8",
    "M16.6 3.2c0 4.9-4.6 5.9-4.6 8.8s4.6 3.9 4.6 8.8",
  ],
  "stunned": [
    "M4 10.5c4.5-6 11.5-6 16 0",
    "M5.4 13.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 16.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM18.6 13.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  ],
  "immobilized": [
    "M4.5 11.6a1.6 1.6 0 0 1 1.6-1.6h11.8a1.6 1.6 0 0 1 1.6 1.6v7.3a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6z",
    "M8.2 10V7.2a3.8 3.8 0 0 1 7.6 0V10",
  ],
  "grabbed": ["M7 12.5V7M11 12V3.8M15 12.5V6.2", "M19 11.5v4.2a6 6 0 0 1-6 6h-1.6A6.4 6.4 0 0 1 5 15.3v-3"],
  "prone": [
    "M5.4 10.3a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z",
    "M8.2 14.6h9.4M8.6 11h6.6", "M2.5 19.5h19",
  ],
  "fleeing": ["M2.5 12h11.5", "M10.5 7.6L14.9 12l-4.4 4.4", "M19.5 4.5v15"],
  "confused": [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    "M9.4 9.4a2.7 2.7 0 1 1 3.5 3.4c-.8.3-1.1 1-1.1 1.7",
    { fill: "M11.8 16.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" },
  ],
  "blinded": [
    "M2.2 12S6 5.8 12 5.8 21.8 12 21.8 12 18 18.2 12 18.2 2.2 12 2.2 12z",
    "M12 9.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z",
    "M3.6 20.4L20.4 3.6",
  ],
  "dazzled": [
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2",
  ],
  "concealed": ["M7 18.5h10a4.2 4.2 0 0 0 .7-8.3A6.3 6.3 0 0 0 5.8 11 3.7 3.7 0 0 0 7 18.5z"],
  "off-guard": [
    "M12 2.8l8 3.2v6c0 5.5-4.4 8.7-8 10.2-3.6-1.5-8-4.7-8-10.2v-6z",
    { dash: [0.1, 3.4], d: "M12 3v19" },
  ],
  "encumbered": ["M4 8.5h16l-1.6 12H5.6z", "M8.6 8.5V6a3.4 3.4 0 0 1 6.8 0v2.5"],
  "fatigued": ["M20 14.2A8.4 8.4 0 0 1 9.8 4a8.6 8.6 0 1 0 10.2 10.2z"],
  "quickened": ["M13.4 2L5 13.2h5.6L9.4 22 19 10.4h-5.8z"],
});
