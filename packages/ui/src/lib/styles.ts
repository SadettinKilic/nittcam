// Shared class fragments for primitives (T101). Tokens only; see tokens.css.

/** Visible keyboard focus: a 2 px focus-colour outline with offset (buttons, toggles, tabs). */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Text-entry focus: accent border plus a soft halo (inputs, selects, textareas). */
export const fieldFocus =
  'outline-none focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25';

/** Base look of every text-entry control. */
export const fieldBase =
  'w-full rounded-md border border-border-strong bg-surface text-sm text-fg shadow-xs ' +
  'transition-[border-color,box-shadow] duration-(--duration-fast) ease-out ' +
  'placeholder:text-fg-subtle hover:border-fg-subtle/60 ' +
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-fg-disabled disabled:shadow-none';

/** Floating layers: popover, menu, select list. */
export const floatingSurface =
  'z-50 rounded-lg border border-border bg-surface-raised text-fg shadow-md ' +
  'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out';

/** One row inside a menu or select list. */
export const menuItem =
  'relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm ' +
  'text-fg outline-none transition-colors duration-(--duration-instant) ' +
  'data-highlighted:bg-surface-hover data-disabled:pointer-events-none data-disabled:text-fg-disabled ' +
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted';
