/**
 * Shared playback store of one sheet's simulation (T157, spec §3.8, §6.5): time, speed and the
 * played G-code line. The 2D canvas, the 3D view, the Z strip and the G-code panel all read it,
 * so scrubbing in one view moves the others to the same line. A tiny external store
 * (`useSyncExternalStore`), no React state per frame outside its subscribers.
 */
import { clampSimTime, lineAt, type SimStep } from '@nittcam/core';
import { useSyncExternalStore } from 'react';

export const SPEEDS = [1, 2, 5, 10, 'max'] as const;
export type Speed = (typeof SPEEDS)[number];

export interface SimPlayerState {
  /** Playback time, s, in [0, duration]. */
  time: number;
  playing: boolean;
  speed: Speed;
  /** The G-code line played at `time` (null before the first move). */
  line: { file: number; line: number } | null;
}

export interface SimPlayer {
  get: () => SimPlayerState;
  subscribe: (listener: () => void) => () => void;
  /** Seeks (clamped to the program); the line follows. */
  setTime: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: Speed) => void;
  /**
   * A new read of the same sheet (autosave, new revision): keeps time, speed and play state,
   * clamped to the new program.
   */
  load: (steps: Steps, duration: number) => void;
  duration: () => number;
}

type Steps = readonly Pick<SimStep, 't0' | 't1' | 'file' | 'line'>[];

export function createSimPlayer(
  initialSteps: Steps,
  initialDuration: number,
  speed: Speed = 5,
): SimPlayer {
  let steps = initialSteps;
  let duration = initialDuration;
  let state: SimPlayerState = { time: 0, playing: false, speed, line: lineAt(steps, 0) };
  const listeners = new Set<() => void>();
  const set = (next: Partial<SimPlayerState>) => {
    const merged = { ...state, ...next };
    if (
      merged.time === state.time &&
      merged.playing === state.playing &&
      merged.speed === state.speed
    )
      return;
    const line = merged.time === state.time ? state.line : lineAt(steps, merged.time);
    // Keep the line object while it names the same line (subscribers compare by identity).
    const same =
      line && state.line && line.file === state.line.file && line.line === state.line.line;
    state = { ...merged, line: same ? state.line : line };
    listeners.forEach((l) => l());
  };
  return {
    duration: () => duration,
    load: (s, d) => {
      if (s === steps && d === duration) return;
      steps = s;
      duration = d;
      const time = clampSimTime(d, state.time);
      state = { ...state, time, line: lineAt(s, time) };
      listeners.forEach((l) => l());
    },
    get: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setTime: (t) => set({ time: clampSimTime(duration, t) }),
    setPlaying: (playing) => set({ playing }),
    setSpeed: (s) => set({ speed: s }),
  };
}

export function useSimPlayer(player: SimPlayer): SimPlayerState {
  return useSyncExternalStore(player.subscribe, player.get, player.get);
}
