/** Shapes of the `/api/templates` route handlers (T147–T149), shared by server and client (D-016). */
import type { TemplateGeometry, TemplateParams } from '@nittcam/core';

/** One version of a company template as the API returns it. */
export interface TemplateItem {
  id: string;
  name: string;
  version: number;
  geometry: TemplateGeometry;
  params: TemplateParams;
}

/** Body of POST /api/templates (new template) and POST /api/templates/:id/versions (new version). */
export interface TemplateDraft {
  name: string;
  geometry: TemplateGeometry;
  params: TemplateParams;
}

export type TemplateApiError =
  | { error: 'invalid_template'; issues: { path: string; message: string }[] }
  | { error: 'not_found' }
  | { error: 'bad_request' }
  | { error: 'server_error' };

/** The company templates (latest versions); `null` when the request fails. */
export async function fetchTemplates(): Promise<TemplateItem[] | null> {
  try {
    const res = await fetch('/api/templates', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as TemplateItem[];
  } catch {
    return null;
  }
}

/** Saves a new template (version 1); `null` when the request fails. */
export async function createTemplate(draft: TemplateDraft): Promise<TemplateItem | null> {
  try {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: draft }),
    });
    if (!res.ok) return null;
    return (await res.json()) as TemplateItem;
  } catch {
    return null;
  }
}
