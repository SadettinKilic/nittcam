import { setConsoleFunction } from 'three';

/**
 * B44 (D-080): three r183 deprecated `THREE.Clock` in favour of `THREE.Timer`, but
 * @react-three/fiber 9.8 (latest) still builds a Clock in its store, so every 3D open printed the
 * deprecation warning. NittCam never creates a Clock itself (render on demand, no `clock` reads),
 * so this one warning is dropped; every other three message goes to the console as before.
 * Remove when fiber moves to Timer.
 */
export const CLOCK_DEPRECATION = 'THREE.Clock: This module has been deprecated';

type Level = 'log' | 'warn' | 'error';

export function threeConsole(type: string, message: unknown, ...params: unknown[]): void {
  if (type === 'warn' && typeof message === 'string' && message.startsWith(CLOCK_DEPRECATION))
    return;
  const level: Level = type === 'warn' || type === 'error' ? type : 'log';
  const first = params[0] as
    { isStackTrace?: boolean; getError?: (m: unknown) => Error } | undefined;
  if (first?.isStackTrace && first.getError) console[level](first.getError(message));
  else console[level](message, ...params);
}

let installed = false;
/** Installs `threeConsole` once (called by the 3D scene chunk on load). */
export function installThreeConsole(): void {
  if (installed) return;
  installed = true;
  setConsoleFunction(threeConsole);
}
