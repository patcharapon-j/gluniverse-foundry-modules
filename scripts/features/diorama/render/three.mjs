/**
 * Diorama — the one door to three.js.
 *
 * Every render module imports three from here, never from the vendor path, so
 * the pinned copy (r169) is swapped in one place.
 */
export * from "../../../vendor/three/three.module.min.js";
