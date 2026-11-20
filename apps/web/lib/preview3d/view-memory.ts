/**
 * 2D/3D choice and 3D camera shared by the wizard's preview panels (T160, spec §3.6): the Plaka
 * and Dizilim steps open in the view the user left, and the 3D camera keeps its pose across step
 * changes. Kept in memory for this page session only (not saved with the project).
 */
import { useEffect, useState } from 'react';
import type { CameraCommand } from '../../components/preview3d/scene';
import { PRESET_MS, type CameraPose, type ViewPreset } from './camera';
import { registerLeaveTransition } from './leave';
import { useMediaQuery } from '../use-media-query';
import { hasWebGL2 } from './capability';

export type ViewMode = '2d' | '3d';
export type FallbackReason = 'webgl' | 'slow';

const memory: { mode: ViewMode; pose: CameraPose | null } = { mode: '2d', pose: null };

/** Remembers the latest camera pose (the 3D host calls it on every camera change). */
export function rememberPose(pose: CameraPose): void {
  memory.pose = pose;
}

/** Test hook: forget the shared view. */
export function resetViewMemory(): void {
  memory.mode = '2d';
  memory.pose = null;
}

/** First command of a newly mounted 3D view: the remembered pose, else the top → iso ease. */
export function initialCommand(): CameraCommand {
  return memory.pose
    ? { preset: 'iso', pose: memory.pose, nonce: 0, animate: false }
    : { preset: 'iso', from: 'top', nonce: 0, animate: true };
}

/** Mode, camera command and fallback note of one preview panel, shared through the memory. */
export function useView3d(available: boolean) {
  const [mode, setModeState] = useState<ViewMode>(() => (available ? memory.mode : '2d'));
  const [noWebGL, setNoWebGL] = useState<FallbackReason | null>(null);
  const [camera, setCamera] = useState<CameraCommand>(initialCommand);
  const show3d = available && mode === '3d';
  // T155 (§3.6): wizard "İleri" with 3D open → ease to the top view first; none with reduced motion.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', false);
  useEffect(() => {
    if (!show3d || reducedMotion) return;
    return registerLeaveTransition(() => {
      setCamera((c) => ({ preset: 'top', nonce: c.nonce + 1, animate: true }));
      return PRESET_MS + 60;
    });
  }, [show3d, reducedMotion]);
  function setMode(next: ViewMode) {
    memory.mode = next;
    setModeState(next);
  }
  function chooseMode(next: ViewMode) {
    if (next === '3d' && !hasWebGL2()) {
      setNoWebGL('webgl');
      setMode('2d');
      return;
    }
    // Every opening eases from top to isometric (a jump with reduced motion, in the rig).
    if (next === '3d' && mode !== '3d') {
      memory.pose = null;
      setCamera((c) => ({ preset: 'iso', from: 'top', nonce: c.nonce + 1, animate: true }));
    }
    setMode(next);
  }
  function preset(p: ViewPreset) {
    setCamera((c) => ({ preset: p, nonce: c.nonce + 1, animate: true }));
  }
  function fallback(reason: FallbackReason) {
    setNoWebGL(reason);
    setMode('2d');
  }
  return {
    mode,
    show3d,
    noWebGL,
    camera,
    setCamera,
    chooseMode,
    preset,
    fallback,
  };
}
