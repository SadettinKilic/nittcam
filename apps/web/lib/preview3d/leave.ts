/**
 * Wizard "İleri" with the 3D view open (T155, spec §3.6): the camera first eases to the top view,
 * then the wizard moves on. The open 3D view registers a handler that starts the ease and returns
 * how long to wait (0 = go now, e.g. with reduced motion); the wizard asks before it navigates.
 * One handler at a time (only one layout view is mounted).
 */
type LeaveHandler = () => number;

let handler: LeaveHandler | null = null;

export function registerLeaveTransition(h: LeaveHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/** Starts the leave transition, if any; returns the ms to wait before navigating. */
export function runLeaveTransition(): number {
  return handler ? Math.max(0, handler()) : 0;
}
