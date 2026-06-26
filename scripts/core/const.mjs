/**
 * GLUniverse Suite — core constants.
 *
 * Every feature in the suite ships as a sub-module of a single installed
 * package (`gluniverse-foundry-modules`). Because Foundry only lets a package register
 * settings / flags / sockets under *its own* id, all former per-module
 * namespaces collapse onto SUITE_ID here, and per-feature isolation is achieved
 * by key-prefixing (settings + flags) and payload-tagging (sockets).
 */

export const SUITE_ID = "gluniverse-foundry-modules";
export const SUITE_TITLE = "GLUniverse Suite";

/** Single shared socket channel. Payloads are tagged with `__feature`. */
export const SOCKET = `module.${SUITE_ID}`;

/** Master enable/disable blob: { [featureId]: boolean }. World-scoped. */
export const SETTING_MODULE_CONFIG = "moduleConfig";

/** True once the suite has finished `ready`. */
export const SETTING_MIGRATION = "migrationVersion";

/** Suite-wide per-client interface scale. Drives the `--gl-ui-scale` custom
 *  property that styles/gl-tokens.css uses to size every UI the suite injects. */
export const SETTING_UI_SCALE = "core.uiScale";

/** Path to a file inside the installed suite package. */
export function suitePath(rel) {
  return `modules/${SUITE_ID}/${rel.replace(/^\/+/, "")}`;
}

/**
 * Resolve a bundled feature file to its installed path.
 *
 * Layout convention (the repo root maps to `modules/gluniverse-foundry-modules/`):
 *   - templates live at  `templates/<featureId>/...`
 *   - assets    live at  `assets/<featureId>/...`
 *   - any other file is resolved inside the feature's script folder.
 *
 * So `featurePath("insight", "templates/x.hbs")` →
 * `modules/gluniverse-foundry-modules/templates/insight/x.hbs`.
 */
export function featurePath(featureId, rel) {
  const r = rel.replace(/^\/+/, "");
  if (r.startsWith("templates/")) return suitePath(`templates/${featureId}/${r.slice("templates/".length)}`);
  if (r.startsWith("assets/")) return suitePath(`assets/${featureId}/${r.slice("assets/".length)}`);
  return suitePath(`scripts/features/${featureId}/${r}`);
}

export const log = (...a) => console.log(`%c${SUITE_TITLE}`, "color:#5eeaff", "|", ...a);
export const warn = (...a) => console.warn(`${SUITE_TITLE} |`, ...a);
export const err = (...a) => console.error(`${SUITE_TITLE} |`, ...a);
