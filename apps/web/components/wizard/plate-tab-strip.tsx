'use client';

import { IconButton } from '@nittcam/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FADE_PX, fadeMask, overflowEdges } from '../../lib/overflow-fade';

/**
 * Floating, horizontally scrolling plate-tab strip (T199b): a clipped edge fades out so a cut-off
 * tab reads as "more this way", the selected tab scrolls into view, and a vertical mouse wheel
 * scrolls the strip sideways. Used by Dizilim and Simülasyon. B67: a clipped side also gets a
 * small arrow button (testers: at 1024 px the third and fourth plate looked cut off and
 * unreachable without a wheel), so every tab can be reached with a click.
 */
export function PlateTabStrip({
  children,
  active,
  className,
  testId,
  scrollLabels,
}: {
  children: ReactNode;
  /** Selected tab value; changes scroll that tab into view. */
  active: string;
  className?: string;
  testId?: string;
  /** Names of the arrow buttons shown on a clipped side. */
  scrollLabels: { prev: string; next: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = overflowEdges(el);
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!el || !tab) return;
    const at = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    const left = at - FADE_PX;
    const right = at + tab.offsetWidth + FADE_PX - el.clientWidth;
    if (el.scrollLeft > left) el.scrollLeft = Math.max(0, left);
    else if (el.scrollLeft < right) el.scrollLeft = right;
    measure();
  }, [active, measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(80, el.clientWidth * 0.8), behavior: 'smooth' });
  };
  const mask = fadeMask(edges);
  const arrow = (dir: 1 | -1) => (
    <IconButton
      size="sm"
      variant="ghost"
      aria-label={dir < 0 ? scrollLabels.prev : scrollLabels.next}
      data-testid={`${testId ?? 'plate-tabs'}-${dir < 0 ? 'prev' : 'next'}`}
      className="h-8 w-6 shrink-0 px-0"
      onClick={() => page(dir)}
    >
      {dir < 0 ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
    </IconButton>
  );
  // The frame (border, background) stays crisp; only the inner scroller fades at a clipped edge.
  return (
    <div
      className={className}
      data-testid={testId}
      data-overflow-start={edges.start || undefined}
      data-overflow-end={edges.end || undefined}
    >
      <div className="flex min-w-0 items-center">
        {edges.start ? arrow(-1) : null}
        <div
          ref={ref}
          onScroll={measure}
          className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        >
          {children}
        </div>
        {edges.end ? arrow(1) : null}
      </div>
    </div>
  );
}
