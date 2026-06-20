/**
 * Shipped support presets — the two NPCs from the "Mission Support System" design
 * doc (Aegis Fallen). Authored with the SupportCard token syntax so their numbers
 * compute from level + benchmark tiers (no actor needed). Imported via the editor;
 * each becomes an editable roster entry. Each carries a bundled `passiveEffect`
 * (a PF2e Effect item) that Import Preset creates & links automatically — the GM
 * only needs to set portraits.
 */

/** @returns {Array<object>} partial supports (SupportStore.makeNew fills defaults/ids). */
export function makeSupportPresets() {
  return [
    {
      name: "Razor",
      role: "Ironroots courier · extraction specialist — the last road out",
      level: 6,
      accent: "#e0a368",
      basePool: 5,
      faction: 3,           // Ironroots track 3 → +0 → 5d6
      discard: 2,
      playerInvoke: true,
      abilities: {
        passive: {
          name: "Last Safe Road",
          costLabel: "Passive",
          traits: ["aura", "support"],
          cardText: "Each ally who can hear Razor on the radio gains a +1 status bonus to Reflex saves and a +1 status bonus to checks to Escape, Balance, Tumble Through, or Stand.",
          effectUuids: []
        },
        radio: {
          name: "No Politics, Just Roads",
          costLabel: "Free · 1/rd",
          traits: ["concentrate", "fortune", "support"],
          cardText: "Choose 1 ally: reroll a check related to movement/escape/pursuit/balance/navigation (Acrobatics, Athletics, Reflex, Driving Lore, Survival) and use the better result (fortune) — or if the ally is frightened, reduce frightened by 1, then they Step as a free action.",
          effectUuids: []
        },
        fieldCombat: {
          name: "Ride the Burning Line",
          costLabel: "1 action",
          traits: ["support", "flourish"],
          cardText: "Razor rips through the field on his bike. Choose one — <b>Extract:</b> drag 1 willing ally up to 25 ft to safe open space; no reactions triggered en route; the ally loses off-guard, grabbed, and prone. <b>Disrupt:</b> @atk[high] Whip Strike, then @roll[athletics|high] versus the target's Fortitude DC — on a success, the target is knocked prone and pulled 10 ft.",
          effectUuids: []
        },
        fieldExplore: {
          name: "Dead-Drop Route",
          costLabel: "Field · explore",
          traits: ["exploration", "support"],
          cardText: "Razor blitz-scouts ahead for the fast, safe line. Choose one: bypass 1 hazard / locked route / traversal obstacle with no roll; shake pursuit once (chase pressure drops 1 step); or buy time (restore filter time / reduce mission-clock pressure 1 step).",
          effectUuids: []
        }
      },
      // Bundled PF2e Effect for the passive — created & linked on Import Preset
      // (icon is swapped to the support's portrait when it auto-applies). Bonuses
      // are flat, so the Proficiency-Without-Level variant doesn't affect them.
      passiveEffect: {
        name: "Last Safe Road",
        type: "effect",
        img: "icons/svg/wing.svg",
        system: {
          description: { value: "<p>While they can hear Razor on the radio, each ally gains a <strong>+1 status bonus to Reflex saves</strong> and a <strong>+1 status bonus</strong> to checks to Escape, Balance, or Tumble Through.</p><p><em>Stand: Razor's call also steadies allies getting up — narrative +1; Stand has no check to modify.</em></p>", gm: "" },
          rules: [
            { key: "FlatModifier", selector: "reflex", type: "status", value: 1, label: "Last Safe Road" },
            { key: "FlatModifier", selector: "skill-check", type: "status", value: 1, label: "Last Safe Road",
              predicate: [{ or: ["action:escape", "action:balance", "action:tumble-through"] }] }
          ],
          traits: { value: ["aura"], rarity: "common" },
          level: { value: 6 },
          duration: { value: -1, unit: "unlimited", sustained: false, expiry: null },
          tokenIcon: { show: true },
          unidentified: false,
          start: { value: 0, initiative: null },
          badge: null,
          slug: "last-safe-road"
        },
        flags: {}
      }
    },
    {
      name: "Tourniquet",
      role: "Ex-Aegis field medic · cold, cruel triage",
      level: 5,
      accent: "#8fc7ff",
      basePool: 4,
      faction: 2,           // Ex-Aegis track 2 → +0 → 4d6
      discard: 2,
      playerInvoke: true,
      abilities: {
        passive: {
          name: "Triage Doctrine",
          costLabel: "Passive",
          traits: ["aura", "support"],
          cardText: "She declares the order of treatment before the blood starts: each ally gains a +1 status bonus to saves vs disease and poison, and a +2 circumstance bonus to recovery checks while dying.",
          effectUuids: []
        },
        radio: {
          name: "Name the Order",
          costLabel: "Free · 1/rd",
          traits: ["concentrate", "support"],
          cardText: "Choose 1 ally: reduce 1 condition value by 1 (frightened, sickened, clumsy, enfeebled, or drained); grant {half} temporary HP; or give a +1 status bonus to their next save.",
          effectUuids: []
        },
        fieldCombat: {
          name: "Tourniquet, Now",
          costLabel: "1 action",
          traits: ["healing", "manipulate", "support"],
          cardText: "She pushes to the front and works on someone right now. Choose 1 ally: if dying, stabilize immediately (back to 1 HP, dying 0) — or @heal[2d8+{level}] and reduce the value of 1 condition by 1 (e.g. drained 2 → drained 1). <i>Triage cost: if another ally is also dying or bloodied, the GM marks 1 of them \"waiting\" until your next field call.</i>",
          effectUuids: []
        },
        fieldExplore: {
          name: "Hold the Line of the Living",
          costLabel: "Field · explore",
          traits: ["exploration", "healing", "support"],
          cardText: "Field surgery / quarantine. Choose one: save a dying survivor the party would otherwise lose; purge 1 infection / contamination / poison / early Verdant Death from an ally or survivor; or turn 1 medical or Supply crisis into a clean outcome (reduce severity 1 step).",
          effectUuids: []
        }
      },
      passiveEffect: {
        name: "Triage Doctrine",
        type: "effect",
        img: "icons/svg/regen.svg",
        system: {
          description: { value: "<p>Tourniquet declares the order of treatment before the blood starts. Each ally gains a <strong>+1 status bonus to saves vs disease and poison</strong>, and a <strong>+2 circumstance bonus to recovery checks</strong> while dying.</p>", gm: "" },
          rules: [
            { key: "FlatModifier", selector: "saving-throw", type: "status", value: 1, label: "Triage Doctrine",
              predicate: [{ or: ["disease", "poison"] }] },
            { key: "FlatModifier", selector: "recovery-check", type: "circumstance", value: 2, label: "Triage Doctrine" }
          ],
          traits: { value: ["aura"], rarity: "common" },
          level: { value: 5 },
          duration: { value: -1, unit: "unlimited", sustained: false, expiry: null },
          tokenIcon: { show: true },
          unidentified: false,
          start: { value: 0, initiative: null },
          badge: null,
          slug: "triage-doctrine"
        },
        flags: {}
      }
    }
  ];
}
