'use client';

import { createContext } from 'react';

/**
 * T321 (usta 2: "1 uyarı" next to "Sorun bulunmadı"): the Simülasyon step's toolpath warnings, so
 * the wizard's "Uyarılar" box shown beside them never says "Sorun bulunmadı" while the summary
 * counts warnings. Null outside the Simülasyon step.
 */
export const SimFindingsContext = createContext<{ warnings: number } | null>(null);
