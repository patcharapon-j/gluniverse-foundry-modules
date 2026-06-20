/**
 * Centralised feature enable/disable registry + resolver.
 *
 * Every module and sub-module the package ships is described once in
 * FEATURE_TREE, and the rest of the codebase asks `Features.on("path.to.feature")`
 * to decide whether to render / wire / open it. This lets a GM trim the module
 * down to exactly what their game needs — drop the whole time tracker, the
 * resource tracker, or just an individual piece of either — from one place
 * (the Module Configuration menu).
 *
 * Backing store:
 *   • Most toggles live in a single world-scoped Object setting (moduleConfig),
 *     keyed by the node's dotted path.
 *   • A node may instead declare `setting: <key>` to be backed by an existing
 *     world setting. The value is read/written through that setting, so its
 *     own onChange side-effects (opening HUDs, re-seating auras…) still fire and
 *     nothing about those features' existing behaviour changes — the menu just
 *     becomes a second, unified place to flip them.
 *
 * A node is only "on" when it AND every ancestor are on, so disabling a parent
 * cleanly takes its whole subtree offline.
 */

import { MODULE_ID, SETTINGS } from "./const.js";

/**
 * The enable/disable tree. Node shape:
 *   key      — unique among siblings; the dotted path of keys is the node id
 *   label    — i18n key for the toggle's label
 *   hint     — i18n key for the description shown under the label
 *   icon     — (optional) Font Awesome class for the group header
 *   default  — default enabled state when nothing is stored
 *   setting  — (optional) existing world-setting key that backs this toggle
 *   pf2eOnly — (optional) only shown / meaningful on PF2e worlds
 *   children — (optional) nested sub-features
 */
export const FEATURE_TREE = [
  {
    key: "timeHud", icon: "fa-solid fa-hourglass-half", default: true,
    label: "GLCT.features.timeHud.name", hint: "GLCT.features.timeHud.hint",
    children: [
      {
        key: "calendar", default: true,
        label: "GLCT.features.timeHud.calendar.name", hint: "GLCT.features.timeHud.calendar.hint",
        children: [
          {
            key: "events", default: true,
            label: "GLCT.features.timeHud.events.name", hint: "GLCT.features.timeHud.events.hint"
          }
        ]
      },
      {
        key: "mission", default: true,
        label: "GLCT.features.timeHud.mission.name", hint: "GLCT.features.timeHud.mission.hint"
      },
      {
        key: "shiftMode", default: true,
        label: "GLCT.features.timeHud.shiftMode.name", hint: "GLCT.features.timeHud.shiftMode.hint"
      },
      {
        key: "sceneTint", setting: SETTINGS.sceneTint, default: false,
        label: "GLCT.features.timeHud.sceneTint.name", hint: "GLCT.features.timeHud.sceneTint.hint"
      },
      {
        key: "gmControls", default: true,
        label: "GLCT.features.timeHud.gmControls.name", hint: "GLCT.features.timeHud.gmControls.hint"
      }
    ]
  },
  {
    key: "trackers", icon: "fa-solid fa-list-check", default: true,
    label: "GLCT.features.trackers.name", hint: "GLCT.features.trackers.hint",
    children: [
      {
        key: "dock", default: true,
        label: "GLCT.features.trackers.dock.name", hint: "GLCT.features.trackers.dock.hint"
      },
      {
        key: "sheet", setting: SETTINGS.sheetTrackersEnabled, default: false, pf2eOnly: true,
        label: "GLCT.features.trackers.sheet.name", hint: "GLCT.features.trackers.sheet.hint"
      }
    ]
  },
  {
    key: "weather", icon: "fa-solid fa-cloud-bolt", setting: SETTINGS.weatherEnabled, default: false,
    label: "GLCT.features.weather.name", hint: "GLCT.features.weather.hint",
    children: [
      {
        key: "hudChip", default: true,
        label: "GLCT.features.weather.hudChip.name", hint: "GLCT.features.weather.hudChip.hint"
      }
    ]
  },
  {
    key: "support", icon: "fa-solid fa-user-shield", setting: SETTINGS.supportEnabled, default: false,
    label: "GLCT.features.support.name", hint: "GLCT.features.support.hint",
    children: [
      {
        key: "passiveTokenIcon", setting: SETTINGS.supportPassiveTokenIcon, default: true, pf2eOnly: true,
        label: "GLCT.features.support.passiveTokenIcon.name", hint: "GLCT.features.support.passiveTokenIcon.hint"
      }
    ]
  },
  {
    key: "delving", icon: "fa-solid fa-dungeon", setting: SETTINGS.delvingEnabled, default: false,
    label: "GLCT.features.delving.name", hint: "GLCT.features.delving.hint"
  }
];

/** Flat path → node index, built once from the tree. */
const NODE_INDEX = (() => {
  const idx = new Map();
  const walk = (nodes, prefix) => {
    for (const node of nodes) {
      const path = prefix ? `${prefix}.${node.key}` : node.key;
      idx.set(path, { ...node, path });
      if (node.children) walk(node.children, path);
    }
  };
  walk(FEATURE_TREE, "");
  return idx;
})();

export const Features = {
  /** The raw moduleConfig blob (path → bool), or {} when unavailable. */
  get _blob() {
    try { return game.settings.get(MODULE_ID, SETTINGS.moduleConfig) || {}; }
    catch { return {}; }
  },

  /** Lookup a node descriptor by its dotted path. */
  node(path) { return NODE_INDEX.get(path) ?? null; },

  /** The full feature tree (for the editor). */
  get tree() { return FEATURE_TREE; },

  /**
   * The configured-or-default state of a single node, ignoring its ancestors.
   * Settings-backed nodes read through their world setting; the rest read the
   * moduleConfig blob.
   */
  self(path) {
    const node = NODE_INDEX.get(path);
    if (!node) return true;                         // unknown paths fail open
    if (node.setting) {
      try { return !!game.settings.get(MODULE_ID, node.setting); }
      catch { return !!node.default; }
    }
    const blob = this._blob;
    return path in blob ? !!blob[path] : !!node.default;
  },

  /** True only when this node AND every ancestor are enabled. */
  on(path) {
    let cur = "";
    for (const part of path.split(".")) {
      cur = cur ? `${cur}.${part}` : part;
      if (!this.self(cur)) return false;
    }
    return true;
  }
};
