/**
 * Width of the rulers on the top and left edges, px. Its own module (T186): the drawing board
 * needs it eagerly, and importing it from `editor-canvas` would load Konva with the page.
 */
export const RULER_PX = 22;
