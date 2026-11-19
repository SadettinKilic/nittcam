/** Shapes of the `/api/templates` route handlers (T147–T149), shared by server and client (D-016). */
import type { TemplateGeometry, TemplateParams } from '@nittcam/core';

/** One version of a company template as the API returns it. */
export interface TemplateItem {
  id: string;
  name: string;
  version: number;
  geometry: TemplateGeometry;
  params: TemplateParams;
  /** Ready library template (T150): read-only, shared by every company. */
  ready?: true;
  /** Ready templates: false until checked against manufacturer data (spec §14.2). */
  verified?: boolean;
  /** Archived company template (T151): hidden from "Şablon ekle"; projects keep their copy. */
  archived?: true;
  /** When this version was saved (ISO); absent on ready templates. */
  createdAt?: string;
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

/**
 * The company templates (latest versions), then the ready library; archived ones only with
 * `archived` (T151). `null` when the request fails.
 */
export async function fetchTemplates(
  opts: { archived?: boolean } = {},
): Promise<TemplateItem[] | null> {
  try {
    const url = opts.archived ? '/api/templates?archived=1' : '/api/templates';
    const res = await fetch(url, { cache: 'no-store' });
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

async function send<T>(url: string, init: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Every version of a template, oldest first (T151); `null` when the request fails. */
export function fetchTemplateVersions(id: string): Promise<TemplateItem[] | null> {
  return send(`/api/templates/${encodeURIComponent(id)}/versions`, { method: 'GET' });
}

/** Saves the next immutable version (T151 "edit params"); `null` when the request fails. */
export function addTemplateVersion(id: string, draft: TemplateDraft): Promise<TemplateItem | null> {
  return send(`/api/templates/${encodeURIComponent(id)}/versions`, {
    method: 'POST',
    body: JSON.stringify({ template: draft }),
  });
}

/** Archives or restores a company template (T151); `null` when the request fails. */
export function setTemplateArchived(id: string, archived: boolean): Promise<TemplateItem | null> {
  return send(`/api/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived }),
  });
}
