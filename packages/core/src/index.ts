/**
 * @nittcam/core — pure CAM kernel (geometry, nesting, toolpath, post).
 * No network, database, clock, randomness or UI code. Same input, same output.
 */

/** All lengths in NittCam are millimetres. */
export type Millimetres = number;

/** Converts inches to millimetres (exact factor 25.4). */
export function inchesToMm(inches: number): Millimetres {
  return inches * 25.4;
}

export * from './schema';
export * from './commands';
export * from './validate';
export * from './geometry';
