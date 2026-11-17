// Collapsed/expanded state of the desktop sidebar (T103), remembered in localStorage.
// The state lives on <html data-sidebar="collapsed">, set by an inline script before the first
// paint (no layout jump on reload); CSS reads the attribute, React subscribes to changes.

export const SIDEBAR_STORAGE_KEY = 'nittcam-sidebar';
const ATTR = 'data-sidebar';
const EVENT = 'nittcam:sidebar';

/** Inline <head> script: applies the stored state before hydration. */
export const SIDEBAR_INIT_SCRIPT =
  `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==='collapsed')` +
  `document.documentElement.setAttribute(${JSON.stringify(ATTR)},'collapsed')}catch(e){}`;

/** Reads a stored value; anything but "collapsed" means expanded. */
export function parseCollapsed(stored: string | null | undefined): boolean {
  return stored === 'collapsed';
}

export function isSidebarCollapsed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(ATTR) === 'collapsed';
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const root = document.documentElement;
  if (collapsed) root.setAttribute(ATTR, 'collapsed');
  else root.removeAttribute(ATTR);
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* storage blocked: the state still applies for this page view */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSidebar(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
