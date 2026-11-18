import { Fragment, createElement, type ReactNode } from 'react';

/**
 * Like `fill()` but the values may be React nodes (T195): lets a translated sentence carry a
 * `Measure` ("Tabla {size} · post {post}"). Unknown placeholders stay as written.
 */
export function fillRich(text: string, values: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/g).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    if (key !== undefined && key in values) return createElement(Fragment, { key: i }, values[key]);
    return part;
  });
}
