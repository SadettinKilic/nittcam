/**
 * The company name and logo for generated documents (T301, CTO #12 E2). The logo goes into PDFs
 * only as PNG or JPEG (what pdf-lib embeds); a WebP logo shows on screen, the PDF keeps the name.
 */
import type { Company, CompanyScope, Storage } from '@nittcam/db';
import { sniffLogo } from '../logo';
import { companyStorage } from './company';
import type { CompanyMark } from './pdf/document';

/** The mark of a company row; the logo bytes are read from the company's storage. */
export async function companyMark(
  company: Pick<Company, 'name' | 'logoKey'> | null | undefined,
  storage: Pick<Storage, 'get'>,
): Promise<CompanyMark | null> {
  if (!company) return null;
  let logo: CompanyMark['logo'] = null;
  if (company.logoKey) {
    try {
      const bytes = await storage.get(company.logoKey);
      const type = bytes ? sniffLogo(bytes) : null;
      if (bytes && (type === 'png' || type === 'jpeg')) logo = { type, bytes };
    } catch {
      logo = null;
    }
  }
  return { name: company.name, logo };
}

/** The mark of the scope's company (its row and storage). */
export async function currentCompanyMark(scope: CompanyScope): Promise<CompanyMark | null> {
  const company = await scope.company.get();
  return company ? companyMark(company, companyStorage(company.id)) : null;
}
