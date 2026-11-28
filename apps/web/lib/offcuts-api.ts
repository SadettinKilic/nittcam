import type { MaterialProps } from '@nittcam/core';
/** Offcut stock API shapes (T168), shared by the routes and the client. */
export type OffcutStatus = 'available' | 'reserved' | 'used';

export interface OffcutItem {
  id: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  /** 0 | 90 like the sheet grain; null = no grain. */
  grain: number | null;
  sourceProjectId: string | null;
  /** Name of the source project in the list (P4); null when unknown or deleted. */
  sourceProjectName?: string | null;
  status: OffcutStatus;
  createdAt: string;
  /** T350: alloy / colour code of the sheet it came from; `{}` = none. */
  props?: MaterialProps;
}

export interface NewOffcut {
  material: string;
  thickness: number;
  width: number;
  height: number;
  grain: 0 | 90 | null;
  sourceProjectId?: string | null | undefined;
  /** T350: the stock's alloy / colour code (absent = none). */
  props?: MaterialProps | undefined;
}

export type OffcutApiError = { error: 'bad_request' | 'not_found' | 'server_error' };
