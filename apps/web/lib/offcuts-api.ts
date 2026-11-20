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
  status: OffcutStatus;
  createdAt: string;
}

export interface NewOffcut {
  material: string;
  thickness: number;
  width: number;
  height: number;
  grain: 0 | 90 | null;
  sourceProjectId?: string | null | undefined;
}

export type OffcutApiError = { error: 'bad_request' | 'not_found' | 'server_error' };
