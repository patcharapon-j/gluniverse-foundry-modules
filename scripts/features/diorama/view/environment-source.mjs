/**
 * Diorama — where a scene's environment comes from (STUB, contract only).
 * Reads the world; environment.mjs is the pure half.
 *
 *   sceneEnvironment(scene, { dayNight }) → resolved env | null
 *       the scene flag (FLAG_ENV), with time of day from the source the GM chose
 *       (dio.envSource: scene | darkness | calendar) and weather from
 *       dio.weatherSource (scene | calendar). dayNight false = this user wants
 *       clear midday light whatever the scene says (weather still shows).
 *   environmentTouched(changes) → bool   an updateScene diff moved FLAG_ENV
 *   ENV_HOOKS: string[]                  hooks after which the env may differ
 *                                        (e.g. updateWorldTime)
 */

export function sceneEnvironment() { return null; }
export function environmentTouched() { return false; }
export const ENV_HOOKS = Object.freeze([]);
