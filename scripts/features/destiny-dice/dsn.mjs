import { DSN_NAMESPACE, FACE_NUMBERS, FATE_DIE_DENOMINATION, FATE_PRESETS, PRESET_DEFAULT } from "./constants.mjs";
import { getActivePresetId, getEmissiveIntensity, getFaceImagePaths } from "./settings.mjs";

export function registerDiceSoNice(dice3d) {
  // Register one colorset per preset so each can carry its own material
  // (e.g. Aegis Fallen uses chrome while Default uses metal).
  for (const preset of Object.values(FATE_PRESETS)) {
    dice3d.addColorset({
      name: preset.dsn.colorsetName,
      description: preset.dsn.colorsetDescription,
      category: "GLUniverse",
      foreground: "#f8f3de",
      background: "#171923",
      outline: "#02040a",
      edge: "#7b6b35",
      material: preset.dsn.material,
      texture: preset.dsn.texture,
      font: "Signika",
    });
  }

  dice3d.addSystem({ id: DSN_NAMESPACE, name: "GLUniverse Destiny Dice" }, "preferred");

  const faces = FACE_NUMBERS.map((face) => getFaceImagePaths(face));
  const presetId = getActivePresetId();
  const preset = FATE_PRESETS[presetId] ?? FATE_PRESETS[PRESET_DEFAULT];

  // The emissive maps already include their final color, so we pass white as
  // the emissive tint (no color shift); intensity is user-configurable.
  dice3d.addDicePreset({
    type: `d${FATE_DIE_DENOMINATION}`,
    labels: faces.map((paths) => paths?.image ?? ""),
    bumpMaps: faces.map((paths) => paths?.bump ?? ""),
    emissiveMaps: faces.map((paths) => paths?.emissive ?? ""),
    emissive: 0xffffff,
    emissiveIntensity: getEmissiveIntensity(),
    colorset: preset.dsn.colorsetName,
    system: DSN_NAMESPACE,
  });

  console.log(`GLUniverse Destiny Dice | Dice So Nice preset registered (1d${FATE_DIE_DENOMINATION}, ${preset.dsn.material})`);
}
