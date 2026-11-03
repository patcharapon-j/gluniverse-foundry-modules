/**
 * The `dz` die term: a d6 whose faces are read through the face table.
 *
 * `CONFIG.Dice.terms` is a global, keyed by one letter. If another package
 * already holds `z` we leave it alone (overwriting it would break their die and
 * look like a bug in their module) and roll a plain d6 instead, read through the
 * same table. Only the 3D die is lost; the fate is the same.
 */

import { warn } from "../../core/const.mjs";
import { FALLBACK_NOTATION, FATE_DIE_DENOMINATION, FATE_DIE_NOTATION, KIND_OPPORTUNITY } from "./constants.mjs";
import { signed } from "./faces.mjs";
import { labelKeyOf } from "./view.mjs";
import { activePreset, face as readFace, t } from "./settings.mjs";

let DieClass = null;
let owned = false;

function fateDieClass() {
  if (DieClass) return DieClass;
  DieClass = class DestinyFateDie extends foundry.dice.terms.Die {
    constructor(termData = {}) {
      super({ ...termData, faces: 6 });
    }

    static DENOMINATION = FATE_DIE_DENOMINATION;

    getResultLabel(result) {
      const f = readFace(result.result);
      if (!f) return String(result.result);
      const label = t(labelKeyOf(activePreset(), f.kind));
      return f.kind !== KIND_OPPORTUNITY && f.bonus !== 0 ? `${label} ${signed(f.bonus)}` : label;
    }
  };
  return DieClass;
}

export function registerFateDie() {
  const terms = CONFIG.Dice.terms;
  const held = terms[FATE_DIE_DENOMINATION];
  if (held && held.name !== "DestinyFateDie") {
    warn(`Destiny Dice | d${FATE_DIE_DENOMINATION} already belongs to ${held.name}; the fate die rolls as ${FALLBACK_NOTATION}`);
    owned = false;
    return false;
  }
  terms[FATE_DIE_DENOMINATION] = fateDieClass();
  owned = true;
  return true;
}

/** Whether `dz` is ours, so Dice So Nice may dress it. */
export const ownsFateDie = () => owned;
export const fateNotation = () => (owned ? FATE_DIE_NOTATION : FALLBACK_NOTATION);
