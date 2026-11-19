// First-use tour of the drawing board (T136, spec §4.2: "İlk kullanımda kısa tanıtım turu ve
// ipuçları"). Five steps, skippable, remembered in localStorage. Pure helpers; the card is
// components/editor/editor-tour.tsx.

/** localStorage key; the value `done` means the tour was finished or skipped. */
export const EDITOR_TOUR_KEY = 'nittcam-editor-tour';

/** Event that starts the tour again (the editor shortcut sheet's "Turu başlat"). */
export const OPEN_EDITOR_TOUR_EVENT = 'nittcam:editor-tour';

export type TourStepId = 'tools' | 'draw' | 'edit' | 'status' | 'help';

export interface TourStep {
  id: TourStepId;
  /** `data-testid` of the element the step points at; skipped when it is not on screen. */
  target: string;
}

export const EDITOR_TOUR: readonly TourStep[] = [
  { id: 'tools', target: 'editor-tool-rail' },
  { id: 'draw', target: 'editor-tool-line' },
  { id: 'edit', target: 'editor-inspector-title' },
  { id: 'status', target: 'editor-status' },
  { id: 'help', target: 'editor-shortcuts' },
];

/** The part of `Storage` the tour uses (easy to fake in tests). */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Should the tour open by itself? Only when storage works and it has not been finished or
 * skipped. Blocked storage (private mode, policy) never shows it: it could not be remembered
 * and would come back on every visit.
 */
export function shouldAutoStartTour(storage: () => TourStorage | null): boolean {
  try {
    const s = storage();
    return s !== null && s.getItem(EDITOR_TOUR_KEY) !== 'done';
  } catch {
    return false;
  }
}

/** Remembers that the tour was finished or skipped; storage errors are ignored. */
export function rememberTourDone(storage: () => TourStorage | null): void {
  try {
    storage()?.setItem(EDITOR_TOUR_KEY, 'done');
  } catch {
    /* storage blocked: nothing to remember */
  }
}

/** Step after a key press in the card: Enter/→ next, ← back, Esc skips (null = close). */
export type TourMove = 'next' | 'back' | 'close';

export function tourMove(step: number, move: TourMove, total = EDITOR_TOUR.length): number | null {
  if (move === 'close') return null;
  if (move === 'back') return Math.max(0, step - 1);
  return step + 1 >= total ? null : step + 1;
}
