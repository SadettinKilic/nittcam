// Open/collapsed state of the canvas workspace side panels (T241, D-039), remembered per browser.
// One key per side for every workspace (board, Dizilim, Simülasyon), so stepping through the
// wizard never makes the canvas jump. Storage may be unavailable (private mode, blocked): then
// the default applies and nothing throws.

export type PanelSide = 'left' | 'right';

export const PANEL_STORAGE_KEY = { left: 'nittcam-panel-left', right: 'nittcam-panel-right' };

/** Below this width the "Parçalar" / settings panel starts collapsed (icon rail). */
export const LEFT_COLLAPSED_BELOW = 1280;

/** Parses a stored value: true = open, false = collapsed, null = no choice stored. */
export function parsePanelState(stored: string | null | undefined): boolean | null {
  return stored === 'open' ? true : stored === 'closed' ? false : null;
}

/** Default when nothing is stored: the left panel collapses below 1280 px, the right never. */
export function defaultPanelOpen(side: PanelSide, viewportWidth: number): boolean {
  return side === 'right' || viewportWidth >= LEFT_COLLAPSED_BELOW;
}

export function readPanelOpen(side: PanelSide, viewportWidth: number): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(PANEL_STORAGE_KEY[side]);
  } catch {
    /* storage blocked */
  }
  return parsePanelState(stored) ?? defaultPanelOpen(side, viewportWidth);
}

export function writePanelOpen(side: PanelSide, open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY[side], open ? 'open' : 'closed');
  } catch {
    /* storage blocked: the state still applies for this page view */
  }
}
