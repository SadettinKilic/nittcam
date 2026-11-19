/**
 * A press on a light row (T118 perf): the row mounted mid-scroll as plain text, so the browser's
 * own click has nothing to focus. The grid renders the row in full first, then `activateAt` does
 * what the click would have done on the real control under the pointer.
 */

/** The caret index nearest to `x` px from the start of the text (`measure` = width of a prefix). */
export function caretIndex(text: string, x: number, measure: (s: string) => number): number {
  if (x <= 0 || text.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= text.length; i++) {
    const dist = Math.abs(measure(text.slice(0, i)) - x);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    } else if (dist > bestDist) {
      break; // widths only grow: past the nearest boundary
    }
  }
  return best;
}

let canvas: HTMLCanvasElement | null = null;

/** Where a click at `clientX` puts the caret in `input` (left or right aligned text). */
function inputCaretAt(input: HTMLInputElement, clientX: number): number {
  const s = getComputedStyle(input);
  canvas ??= document.createElement('canvas');
  const g = canvas.getContext('2d');
  if (!g) return input.value.length;
  g.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const measure = (t: string) => g.measureText(t).width;
  const r = input.getBoundingClientRect();
  const px = (v: string) => Number.parseFloat(v) || 0;
  const left = r.left + px(s.borderLeftWidth) + px(s.paddingLeft);
  const inner =
    r.width -
    px(s.borderLeftWidth) -
    px(s.paddingLeft) -
    px(s.paddingRight) -
    px(s.borderRightWidth);
  const right = s.textAlign === 'right' || s.textAlign === 'end';
  const start = right ? left + Math.max(0, inner - measure(input.value)) : left;
  return caretIndex(input.value, clientX - start + input.scrollLeft, measure);
}

const CONTROL = 'input, button, [role="checkbox"]';
/** A forwarded click only counts right after the press (a drag away must not click later). */
const CLICK_WINDOW_MS = 1500;

/**
 * Focuses the control at (x, y) in `cell` as a click would: an input gets the caret at the click
 * point (in edit mode); a button gets focus, and the click that follows the press is passed on to
 * it (the browser sends it to the cell, the common ancestor of the press and the release).
 */
export function activateAt(cell: HTMLElement, x: number, y: number): void {
  const hit = document.elementFromPoint(x, y);
  const control =
    (hit && cell.contains(hit) ? hit.closest<HTMLElement>(CONTROL) : null) ??
    cell.querySelector<HTMLElement>(CONTROL);
  if (!control || !cell.contains(control)) return;
  if (control instanceof HTMLInputElement) {
    // The cell's own mousedown handler marks a pointer focus (edit mode, no select-all).
    control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    control.focus();
    const i = inputCaretAt(control, x);
    control.setSelectionRange(i, i);
    return;
  }
  control.focus();
  const pressed = performance.now();
  const forward = (e: MouseEvent) => {
    cell.removeEventListener('click', forward, true);
    if (performance.now() - pressed > CLICK_WINDOW_MS) return;
    if (e.target instanceof Node && control.contains(e.target)) return; // it got the click itself
    e.stopPropagation();
    control.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      }),
    );
  };
  cell.addEventListener('click', forward, true);
}
