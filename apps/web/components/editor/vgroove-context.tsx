'use client';

import { createContext, useContext } from 'react';
import { NO_VGROOVE, type VGrooveInfo } from '../../lib/vgroove-info';

export { vGrooveInfoOf, type VGrooveInfo } from '../../lib/vgroove-info';

export const VGrooveContext = createContext<VGrooveInfo>(NO_VGROOVE);

export function useVGroove(): VGrooveInfo {
  return useContext(VGrooveContext);
}
