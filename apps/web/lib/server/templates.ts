/** Server helpers of the template library API (T147–T149): validation and row mapping. */
import {
  templateGeometrySchema,
  templateParamsSchema,
  type TemplateGeometry,
  type TemplateParams,
} from '@nittcam/core';
import type { TemplateRow, TemplateVersionRow } from '@nittcam/db';
import { NextResponse } from 'next/server';
import type { TemplateApiError, TemplateDraft, TemplateItem } from '../templates-api';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Issues = { path: string; message: string }[];

export function toItem(template: TemplateRow, version: TemplateVersionRow): TemplateItem {
  return {
    id: template.id,
    name: template.name,
    version: version.version,
    geometry: version.geometry as unknown as TemplateGeometry,
    params: version.params as unknown as TemplateParams,
  };
}

export function templateError(body: TemplateApiError, status: number) {
  return NextResponse.json(body, { status });
}

/** Validates a template draft with the core schemas; the draft or the issues. */
export function parseDraft(raw: unknown): TemplateDraft | { issues: Issues } {
  const issues: Issues = [];
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (name.length === 0) issues.push({ path: 'name', message: 'must not be empty' });
  else if (name.length > 80) issues.push({ path: 'name', message: 'at most 80 characters' });
  for (const k of Object.keys(o)) {
    if (k !== 'name' && k !== 'geometry' && k !== 'params') {
      issues.push({ path: k, message: 'unknown field' });
    }
  }
  const g = templateGeometrySchema.safeParse(o.geometry);
  const p = templateParamsSchema.safeParse(o.params);
  for (const [prefix, r] of [
    ['geometry', g],
    ['params', p],
  ] as const) {
    if (!r.success) {
      for (const i of r.error.issues) {
        issues.push({ path: [prefix, ...i.path].join('.'), message: i.message });
      }
    }
  }
  if (issues.length > 0 || !g.success || !p.success) return { issues };
  // Diameter params must name holes of the template.
  for (const id of Object.keys(p.data.d)) {
    if (!g.data.holes.some((h) => h.id === id)) {
      return { issues: [{ path: `params.d.${id}`, message: 'no hole with this id' }] };
    }
  }
  return { name, geometry: g.data, params: p.data };
}

/** Reads `{ template }`; `undefined` when the body is not JSON or has no template. */
export async function readTemplate(
  request: Request,
): Promise<TemplateDraft | { issues: Issues } | undefined> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && 'template' in body) return parseDraft(body.template);
  } catch {
    // fall through
  }
  return undefined;
}

export function handleTemplateError(err: unknown) {
  console.error(err);
  return templateError({ error: 'server_error' }, 500);
}
