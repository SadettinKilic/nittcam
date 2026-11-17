'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lets a page put things into the top bar (T103): a page-actions slot, a save-status slot and the
 * title of the current page (last breadcrumb, e.g. the project name).
 */
interface ShellSlots {
  actions: HTMLElement | null;
  status: HTMLElement | null;
  setActions: (el: HTMLElement | null) => void;
  setStatus: (el: HTMLElement | null) => void;
  title: string | null;
  setTitle: (title: string | null) => void;
}

const ShellContext = createContext<ShellSlots | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(
    () => ({ actions, status, setActions, setStatus, title, setTitle }),
    [actions, status, title],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShellSlots(): ShellSlots | null {
  return useContext(ShellContext);
}

/** Renders children in the top bar's page-actions slot (inline when there is no shell). */
export function ShellActions({ children }: { children: ReactNode }) {
  const slots = useContext(ShellContext);
  if (!slots) return <>{children}</>;
  return slots.actions ? createPortal(children, slots.actions) : null;
}

/** Renders children (e.g. the save status) in the top bar's status slot. */
export function ShellStatus({ children }: { children: ReactNode }) {
  const slots = useContext(ShellContext);
  if (!slots) return <>{children}</>;
  return slots.status ? createPortal(children, slots.status) : null;
}

/** Sets the top-bar title (last breadcrumb) while the calling page is mounted. */
export function useShellTitle(title: string | null): void {
  const setTitle = useContext(ShellContext)?.setTitle;
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
