/**
 * The one Immer instance of core (spec §5.1). It turns the patches plugin on as a side of
 * importing it, so every module that produces patches imports `immer` from here: with
 * `"sideEffects"` in package.json a bundler may drop unused modules, and a bare
 * `enablePatches()` in some other file could be dropped with them (T186).
 */
import { Immer, enablePatches } from 'immer';

enablePatches();

/** Private instance so core never changes the global Immer configuration. */
export const immer = new Immer({ autoFreeze: true });
