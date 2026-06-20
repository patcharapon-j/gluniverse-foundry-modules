/**
 * GLUniverse Suite — feature roster.
 *
 * Importing this module imports every feature adapter, each of which calls
 * `Suite.register(...)` at load time. The import order here is the display
 * order in the Feature Manager. New features are appended as they are ported.
 */

import "./clocks-tracker/index.mjs";
import "./initiative/index.mjs";
import "./flatfinder/index.mjs";
import "./destiny-dice/index.mjs";
import "./insight/index.mjs";
import "./stage/index.mjs";
import "./stream-pacer/index.mjs";
import "./stream/index.mjs";
import "./statsblock-import/index.mjs";
import "./loot-gen/index.mjs";
import "./cargo-grid/index.mjs";
import "./tidy5e-slots/index.mjs";
import "./pf2e-flatten/index.mjs";
import "./critical/index.mjs";
