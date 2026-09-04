/** Stable serializable fixtures for Spellglass schema/classification checks. */

export const sourceFixtures = Object.freeze({
  fireball: Object.freeze({
    documentName: "Region",
    name: "Fireball Region",
    shapes: [{ type: "circle", x: 100, y: 100, radius: 400 }],
    flags: { pf2e: { areaShape: "burst", origin: { name: "Fireball", type: "spell", traits: ["fire"] } } },
  }),
  healingField: Object.freeze({
    documentName: "Region",
    shapes: [{ type: "circle", x: 100, y: 100, radius: 200 }],
    flags: { pf2e: { areaShape: "emanation", origin: { name: "Field of Renewal", type: "spell", traits: ["healing", "vitality"] } } },
  }),
  difficultTerrain: Object.freeze({
    documentName: "Region",
    shapes: [{ type: "polygon", points: [0, 0, 100, 0, 100, 100] }],
    flags: {},
    behaviors: [{ type: "modifyMovementCost" }],
  }),
  unknown: Object.freeze({ documentName: "Region", shapes: [{ type: "polygon", points: [] }], flags: {} }),
});

export const itemFixtures = Object.freeze({
  fireball: Object.freeze({
    type: "spell",
    name: "Fireball",
    slug: "fireball",
    system: { traits: { value: ["fire"] }, damage: { damage: { type: "fire", formula: "6d6" } } },
  }),
  healingField: Object.freeze({
    type: "spell",
    name: "Field of Renewal",
    slug: "field-of-renewal",
    system: { traits: { value: ["healing", "vitality"] }, damage: { healing: { type: "vitality", formula: "3d8" } } },
  }),
});

export const legacyFixtures = Object.freeze([
  Object.freeze({ uuid: "Scene.A.Region.1", style: { archetype: "ember", colorOverride: true, color: "#FF5500", label: "Fireball" } }),
  Object.freeze({ uuid: "Scene.A.Region.2", style: { archetype: "verdant", label: "" } }),
  Object.freeze({ uuid: "Scene.B.Region.3", style: { archetype: "mystery", color: "orange", label: 12 } }),
  Object.freeze({ uuid: "Scene.B.Region.4", style: null, suppressed: true }),
]);
