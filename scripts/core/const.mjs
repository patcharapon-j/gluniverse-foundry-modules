/**
 * GLUniverse Suite — core constants.
 *
 * Every feature in the suite ships as a sub-module of a single installed
 * package (`gluniverse-suite`). Because Foundry only lets a package register
 * settings / flags / sockets under *its own* id, all former per-module
 * namespaces collapse onto SUITE_ID here, and per-feature isolation is achieved
 * by key-prefixing (settings + flags) and payload-tagging (sockets).
 */

export const SUITE_ID = "gluniverse-suite";
export const SUITE_TITLE = "GLUniverse Suite";

/** Single shared socket channel. Payloads are tagged with `__feature`. */
export const SOCKET = `module.${SUITE_ID}`;

/** Master enable/disable blob: { [featureId]: boolean }. World-scoped. */
export const SETTING_MODULE_CONFIG = "moduleConfig";

/** True once the suite has finished `ready`. */
export const SETTING_MIGRATION = "migrationVersion";

/** Path to a file inside the installed suite package. */
export function suitePath(rel) {
  return `modules/${SUITE_ID}/${rel.replace(/^\/+/, "")}`;
}

/** Path to a file inside a feature's own folder. */
export function featurePath(featureId, rel) {
  return suitePath(`features/${featureId}/${rel.replace(/^\/+/, "")}`);
}

export const log = (...a) => console.log(`%c${SUITE_TITLE}`, "color:#5eeaff", "|", ...a);
export const warn = (...a) => console.warn(`${SUITE_TITLE} |`, ...a);
export const err = (...a) => console.error(`${SUITE_TITLE} |`, ...a);
