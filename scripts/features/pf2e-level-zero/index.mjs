import { Suite } from "../../core/registry.mjs";
import { onReady } from "./main.mjs";

Suite.register({
  id: "pf2e-level-zero",
  title: "GLS.feature.pf2e-level-zero.title",
  hint: "GLS.feature.pf2e-level-zero.hint",
  icon: "fa-solid fa-seedling",
  settingPrefix: "l0.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings() {},
  onReady,
  api: null,
});
