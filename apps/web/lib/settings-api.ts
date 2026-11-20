/** Shapes of the `/api/settings` route handlers, shared by server and client (T182). */
import type { ProjectDefaults } from '@nittcam/core';

export const COMPANY_NAME_MAX = 120;

export interface CompanySettings {
  name: string;
  /** Logo URL with a version query (cache busting), or null when none is uploaded. */
  logoUrl: string | null;
  defaults: ProjectDefaults;
}

/** The company's project defaults for a new project; built-ins when the request fails. */
export async function fetchProjectDefaults(): Promise<ProjectDefaults | undefined> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) return undefined;
    return ((await res.json()) as CompanySettings).defaults;
  } catch {
    return undefined;
  }
}
