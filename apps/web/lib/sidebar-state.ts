// Collapsed/expanded state of the desktop sidebar (T103), remembered in localStorage.
// The state lives on <html data-sidebar="collapsed">, set by an inline script before the first
// paint (no layout jump on reload); CSS reads the attribute, React subscribes to changes.
//
// T263 (D-045): below 1440 px the workspace steps (drawing board, Dizilim, Simülasyon) open with
// the icon rail, so the canvas gets the width. The user's own toggle there wins and is remembered
// under its own key; everywhere else (and on the workspace at ≥ 1440 px) the T103 key applies.

export const SIDEBAR_STORAGE_KEY = 'nittcam-sidebar';
export const WORKSPACE_SIDEBAR_STORAGE_KEY = 'nittcam-sidebar-workspace';
/** Below this width the workspace steps default to the icon rail. */
export const RAIL_BELOW_PX = 1440;
const ATTR = 'data-sidebar';
const EVENT = 'nittcam:sidebar';

/** Reads a stored value; anything but "collapsed" means expanded. */
export function parseCollapsed(stored: string | null | undefined): boolean {
  return stored === 'collapsed';
}

/** Whether a URL shows a workspace step: Dizilim, Simülasyon, or the parts step's drawing board. */
export function isWorkspaceUrl(pathname: string, search: string): boolean {
  if (!pathname.startsWith('/projeler/')) return false;
  const q = new URLSearchParams(search);
  const step = q.get('adim');
  return (
    step === 'dizilim' ||
    step === 'simulasyon' ||
    (step === 'parcalar' && q.get('gorunum') === 'cizim')
  );
}

export interface SidebarContext {
  /** A workspace step is on screen. */
  workspace: boolean;
  /** Viewport width in CSS px. */
  width: number;
}

/** True when the workspace rule (and its own remembered toggle) decides the state. */
export function usesWorkspaceRule(ctx: SidebarContext): boolean {
  return ctx.workspace && ctx.width < RAIL_BELOW_PX;
}

/** The effective state: workspace below 1440 → its own choice, else the rail; otherwise T103. */
export function resolveCollapsed(
  ctx: SidebarContext,
  stored: string | null | undefined,
  storedWorkspace: string | null | undefined,
): boolean {
  if (usesWorkspaceRule(ctx)) return storedWorkspace !== 'expanded';
  return parseCollapsed(stored);
}

/** Inline <head> script: applies the stored state (and the workspace rule) before hydration. */
export const SIDEBAR_INIT_SCRIPT =
  `try{var l=location,q=new URLSearchParams(l.search),a=q.get('adim'),` +
  `w=l.pathname.indexOf('/projeler/')===0&&(a==='dizilim'||a==='simulasyon'||(a==='parcalar'&&q.get('gorunum')==='cizim')),` +
  `c=w&&innerWidth<${RAIL_BELOW_PX}` +
  `?localStorage.getItem(${JSON.stringify(WORKSPACE_SIDEBAR_STORAGE_KEY)})!=='expanded'` +
  `:localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==='collapsed';` +
  `if(c)document.documentElement.setAttribute(${JSON.stringify(ATTR)},'collapsed')}catch(e){}`;

let workspaceActive = false;

function context(): SidebarContext {
  return { workspace: workspaceActive, width: window.innerWidth };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applyAttr(collapsed: boolean): void {
  const root = document.documentElement;
  if (collapsed === (root.getAttribute(ATTR) === 'collapsed')) return;
  if (collapsed) root.setAttribute(ATTR, 'collapsed');
  else root.removeAttribute(ATTR);
  window.dispatchEvent(new Event(EVENT));
}

/** Re-derives the state from the context and storage (step change, resize). */
export function syncSidebar(): void {
  if (typeof document === 'undefined') return;
  applyAttr(
    resolveCollapsed(context(), read(SIDEBAR_STORAGE_KEY), read(WORKSPACE_SIDEBAR_STORAGE_KEY)),
  );
}

/** The wizard reports whether a workspace step is on screen (and false when it unmounts). */
export function setSidebarWorkspace(active: boolean): void {
  if (workspaceActive === active) return;
  workspaceActive = active;
  // Leaving is applied a tick later: a wizard that remounts (first save) reports false then
  // true in one go, and the rail must not open and close in between.
  if (active) syncSidebar();
  else
    window.setTimeout(() => {
      if (!workspaceActive) syncSidebar();
    }, 0);
}

export function isSidebarCollapsed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(ATTR) === 'collapsed';
}

/** The user's toggle: remembered under the key of the rule that is in charge right now. */
export function setSidebarCollapsed(collapsed: boolean): void {
  const key = usesWorkspaceRule(context()) ? WORKSPACE_SIDEBAR_STORAGE_KEY : SIDEBAR_STORAGE_KEY;
  try {
    localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* storage blocked: the state still applies for this page view */
  }
  applyAttr(collapsed);
}

export function subscribeSidebar(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
