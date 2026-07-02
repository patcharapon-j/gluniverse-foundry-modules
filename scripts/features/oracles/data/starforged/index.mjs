/**
 * GLUniverse Suite — Oracles feature: the STARFORGED pack.
 *
 * Full port of the Ironsworn: Starforged oracle library (Reference Guide,
 * March 2024): space encounters, planets (11 world classes), settlements,
 * starships, characters, creatures, factions, derelicts (8 zones),
 * precursor vaults, location themes, and miscellaneous oracles.
 *
 * Contains material from Ironsworn: Starforged by Shawn Tomkin, licensed
 * under CC BY 4.0 (ironswornrpg.com). Ironsworn and Starforged are
 * trademarks of Shawn Tomkin and are not claimed by this module.
 *
 * Table data lives in the sibling fragment files; this module is the pack
 * manifest: context axis (Region), Tier-1 slot bindings, assembly order.
 */

import { TABLES as SPACE_PLANETS } from "./space-planets.mjs";
import { TABLES as SOCIETY } from "./society.mjs";
import { TABLES as DERELICTS } from "./derelicts.mjs";
import { TABLES as VAULTS_THEMES_MISC } from "./vaults-themes-misc.mjs";

export default {
  id: "starforged",
  label: "Starforged (Sci-Fi)",
  attribution:
    "Contains material from Ironsworn: Starforged by Shawn Tomkin, licensed under CC BY 4.0.",
  context: {
    key: "region",
    label: "Region",
    values: [
      { id: "terminus", label: "Terminus" },
      { id: "outlands", label: "Outlands" },
      { id: "expanse", label: "Expanse" },
    ],
    default: "terminus",
  },
  slots: {
    character: "character-first-look",
    place: "planet-class",
    settlement: "settlement-location",
    faction: "faction-type",
    creature: "creature-environment",
    encounter: "space-sighting",
    "location-theme": "location-theme-type",
    complication: "story-complication",
  },
  tables: [
    ...SPACE_PLANETS,
    ...SOCIETY,
    ...DERELICTS,
    ...VAULTS_THEMES_MISC,
  ],
};
