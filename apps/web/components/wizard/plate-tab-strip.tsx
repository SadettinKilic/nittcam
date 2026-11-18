'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FADE_PX, fadeMask, overflowEdges } from '../../lib/overflow-fade';

/**
 * Floating, horizontally scrolling plate-tab strip (T199b): a clipped edge fades out so a cut-off
 * tab reads as "more this way", the selected tab scrolls into view, and a vertical mouse wheel
 * scrolls the strip sideways. Used by Dizilim and Simülasyon.
 */
export function PlateTabStrip({
  children,
  active,
  className,
  testId,
}: {
  children: ReactNode;
  /** Selected tab value; changes scroll that tab into view. */
  active: string;
  className?: string;
  testId?: string;
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

  const mask = fadeMask(edges);
  // The frame (border, background) stays crisp; only the inner scroller fades at a clipped edge.
  return (
    <div
      className={className}
      data-testid={testId}
      data-overflow-start={edges.start || undefined}
      data-overflow-end={edges.end || undefined}
    >
      <div
        ref={ref}
        onScroll={measure}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
