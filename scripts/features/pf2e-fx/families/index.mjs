/**
 * Spellsprite — the family registry.
 *
 * A family is how a group of materials moves. Its module exports:
 *
 *   id                         the family id (constants.mjs FAMILIES)
 *   burst(s, M, {x,y,z,pow,rad})       a release at a point: impact, area, explosion
 *   trail(s, M, {x,y,z,dt})            what a projectile sheds each frame
 *   linger(s, M, {at,spot,k,dt,rad,x,y})   an area left burning after the release;
 *                                      `at(rate, mk)` spawns `mk()` at random spots
 *   spray(s, M, {emit,hand,dir,half,len,dt})   a cone or line pouring from the hand;
 *                                      `emit(kind, rate, mk)` throws particles along it
 *   auraStart?(s, M, T)                persistent decals when a condition starts
 *   aura(s, M, {at,body,T,dt})         a condition's loop on a creature
 *   tick?(s, M, T)                     extra beat on a condition's tick
 *   bloom?(s, M, B)                    the `bloom` delivery on a creature (deliveries.mjs
 *                                      `bloomCtx` says what B carries); none: the generic bloom
 *   dark?, gentle?, projectileBolt?    flags (see compile.mjs)
 *
 * `M.material` tells a family which of its materials it is drawing, so poison
 * can be greener and cloudier than acid inside the one corrode family.
 */

import flame from "./flame.mjs";
import frost from "./frost.mjs";
import arc from "./arc.mjs";
import corrode from "./corrode.mjs";
import shock from "./shock.mjs";
import radiance from "./radiance.mjs";
import umbra from "./umbra.mjs";
import psyche from "./psyche.mjs";
import earthwork from "./earthwork.mjs";
import tide from "./tide.mjs";
import growth from "./growth.mjs";
import physical from "./physical.mjs";

export const FAMILY_MODULES = Object.freeze({ flame, frost, arc, corrode, shock, radiance, umbra, psyche, earthwork, tide, growth, physical });

export const familyModule = (id) => FAMILY_MODULES[id] ?? physical;
