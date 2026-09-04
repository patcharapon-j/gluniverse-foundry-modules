/** Explicit GM migration orchestration around the pure schema-v2 converter. */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { FLAGS, SETTINGS } from "./constants.mjs";
import { migrationPreflight } from "./migration.mjs";
import { PRESENTATION_SCHEMA } from "./schema.mjs";

const t = (key) => game.i18n.localize(key);

function legacyCandidates() {
  const candidates = [];
  for (const scene of game.scenes ?? []) for (const region of scene.regions ?? []) {
    let style = null, suppressed = false;
    try { style = region.getFlag(SUITE_ID, FLAGS.style); suppressed = Boolean(region.getFlag(SUITE_ID, FLAGS.suppress)); }
    catch { /* inaccessible */ }
    if (style || suppressed) candidates.push({ uuid: region.uuid, sceneId: scene.id, regionId: region.id, style, suppressed });
  }
  return candidates;
}

async function confirm(report) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2) return false;
  return DialogV2.confirm({
    window: { title: t("GLAOE.Migration.Title") },
    content: `<div class="standard-form"><p>${game.i18n.format("GLAOE.Migration.Summary", report.counts)}</p><p class="hint">${t("GLAOE.Migration.BackupHint")}</p></div>`,
    yes: { label: t("GLAOE.Migration.Run"), icon: "fa-solid fa-wand-magic-sparkles" },
    no: { label: t("GLAOE.Migration.Later"), icon: "fa-solid fa-clock" },
  });
}

export async function migrateLegacyPresentations() {
  if (!game.user?.isGM) return { migrated: false, reason: "not-gm" };
  const version = Number(game.settings.get(SUITE_ID, SETTINGS.schemaVersion) ?? 0);
  if (version >= PRESENTATION_SCHEMA) return { migrated: false, reason: "current" };
  const candidates = legacyCandidates();
  if (!candidates.length) {
    await game.settings.set(SUITE_ID, SETTINGS.schemaVersion, PRESENTATION_SCHEMA);
    return { migrated: false, reason: "empty" };
  }
  const report = migrationPreflight(candidates, {
    moduleVersion: game.modules.get(SUITE_ID)?.version,
    systemVersion: game.system?.version,
    legacySettings: game.settings.get(SUITE_ID, SETTINGS.styleDefaults),
  });
  if (!await confirm(report)) return { migrated: false, reason: "declined", report };
  foundry.utils.saveDataToFile(JSON.stringify(report, null, 2), "application/json", `spellglass-migration-backup-${Date.now()}.json`);
  const byUuid = new Map(report.entries.map((entry) => [entry.uuid, entry]));
  let completed = 0;
  try {
    for (const scene of game.scenes ?? []) {
      const updates = [];
      for (const region of scene.regions ?? []) {
        const entry = byUuid.get(region.uuid); if (!entry) continue;
        const update = { _id: region.id };
        foundry.utils.setProperty(update, `flags.${SUITE_ID}.${FLAGS.presentation}`, entry.presentation);
        foundry.utils.setProperty(update, `flags.${SUITE_ID}.aoe.-=style`, null);
        foundry.utils.setProperty(update, `flags.${SUITE_ID}.aoe.-=suppress`, null);
        updates.push(update);
      }
      if (updates.length) { await scene.updateEmbeddedDocuments("Region", updates); completed += updates.length; }
    }
    await game.settings.set(SUITE_ID, SETTINGS.schemaVersion, PRESENTATION_SCHEMA);
    ui.notifications?.info(game.i18n.format("GLAOE.Migration.Complete", { count: completed }));
    return { migrated: true, completed, report };
  } catch (error) {
    warn("pf2e-aoe | migration stopped", error);
    ui.notifications?.error(game.i18n.format("GLAOE.Migration.Failed", { count: completed }));
    return { migrated: false, reason: "failed", completed, error, report };
  }
}
