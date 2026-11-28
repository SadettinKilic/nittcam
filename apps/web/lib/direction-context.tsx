'use client';

import { materialKindOf, traitsOf, type MaterialTraits } from '@nittcam/core';
import { createContext, useContext } from 'react';
import { useMessages } from './messages-context';
import type { Messages } from './messages';

export type DirectionLabel = MaterialTraits['direction']['label'];
export type DirectionText = Messages['direction']['grain'];

/**
 * T347 (§3.6 "Yön"): the wording of the stock's direction, from the behaviour table: "Damar yönü"
 * (wood), "Yüzey yönü" (aluminium), "Film oku yönü" (ACM). Default `grain` = today's texts.
 */
export const DirectionLabelContext = createContext<DirectionLabel>('grain');

export function directionLabelOf(material: string): DirectionLabel {
  return traitsOf(materialKindOf(material)).direction.label;
}

/** The direction texts of the current stock (wizard provider; outside it: "Damar"). */
export function useDirectionText(): DirectionText {
  return useMessages().direction[useContext(DirectionLabelContext)];
}
