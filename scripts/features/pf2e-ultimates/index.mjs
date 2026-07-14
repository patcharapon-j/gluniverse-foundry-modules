import { Suite } from "../../core/registry.mjs";
import { onInit, onReady, api } from "./main.mjs";

Suite.register({
  id: "pf2e-ultimates",
  title: "GLS.feature.pf2e-ultimates.title",
  hint: "GLS.feature.pf2e-ultimates.hint",
  icon: "fa-solid fa-star",
  settingPrefix: "ult.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {},
  onInit,
  onReady,
  api,
});

