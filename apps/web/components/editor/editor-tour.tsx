'use client';

import { Button } from '@nittcam/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { Messages } from '../../lib/messages';
import {
  EDITOR_TOUR,
  OPEN_EDITOR_TOUR_EVENT,
  rememberTourDone,
  shouldAutoStartTour,
  tourMove,
  type TourMove,
} from '../../lib/editor/tour';

const storage = () => (typeof window === 'undefined' ? null : window.localStorage);

/**
 * First-use tour of the drawing board (T136, spec §4.2): five short steps in a floating card at
 * the bottom of the canvas, each pointing at one part of the board with an outline. Opens by
 * itself once, is skippable (Esc or "Turu atla") and remembered; the editor shortcut sheet starts
 * it again. Keyboard only: focus sits on the main button (Enter = next), ← / → move, Esc skips.
 * No animation of its own, so reduced motion needs nothing extra.
 */
export function EditorTour({
  t,
  onClose,
}: {
  t: Messages['editor']['tour'];
  onClose?: () => void;
}) {
  const [step, setStep] = useState<number | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    // A frame after mount, so the board's tools are laid out; never during SSR.
    const frame = requestAnimationFrame(() => {
      if (shouldAutoStartTour(storage)) setStep(0);
    });
    const open = () => setStep(0);
    window.addEventListener(OPEN_EDITOR_TOUR_EVENT, open);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(OPEN_EDITOR_TOUR_EVENT, open);
    };
  }, []);

  const current = step === null ? null : EDITOR_TOUR[step];

  // Outline the element the step points at (when it is on screen) and keep focus in the card.
  useEffect(() => {
    if (!current) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="${current.target}"]`);
    el?.setAttribute('data-tour-target', '');
    primary.current?.focus({ preventScroll: true });
    return () => el?.removeAttribute('data-tour-target');
  }, [current]);

  if (step === null || !current) return null;

  const go = (move: TourMove) => {
    const next = tourMove(step, move);
    if (next === null) {
      rememberTourDone(storage);
      setStep(null);
      onClose?.();
    } else setStep(next);
  };
  const last = step === EDITOR_TOUR.length - 1;
  const text = t.steps[current.id];

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t.label}
      aria-describedby={`${id}-body`}
      data-testid="editor-tour"
      data-step={current.id}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-30 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-border bg-surface-raised p-4 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') go('close');
        else if (e.key === 'ArrowRight') go('next');
        else if (e.key === 'ArrowLeft') go('back');
        else return;
        // The board's own keys (Esc clears the selection) must not see these.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      }}
    >
      <p
        className="text-2xs font-medium text-fg-muted tabular-nums"
        data-testid="editor-tour-progress"
      >
        {t.progress.replace('{n}', String(step + 1)).replace('{total}', String(EDITOR_TOUR.length))}
      </p>
      <h2 className="mt-1 text-sm font-semibold text-fg" id={`${id}-title`}>
        {text.title}
      </h2>
      <p className="mt-1 text-sm text-fg-muted" id={`${id}-body`}>
        {text.body}
      </p>
      <p className="mt-2 text-2xs text-fg-subtle max-sm:hidden">{t.keys}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2"
          data-testid="editor-tour-skip"
          onClick={() => go('close')}
        >
          {t.skip}
        </Button>
        <span className="ml-auto" />
        {step > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="editor-tour-back"
            onClick={() => go('back')}
          >
            {t.back}
          </Button>
        ) : null}
        <Button
          ref={primary}
          size="sm"
          variant="primary"
          data-testid="editor-tour-next"
          onClick={() => go('next')}
        >
          {last ? t.done : t.next}
        </Button>
      </div>
    </div>
  );
}
