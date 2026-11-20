'use client';

import { DXF_LAYER_OPS, MAX_DXF_LAYER_MAP, type DxfLayerMap, type DxfLayerOp } from '@nittcam/core';
import {
  Button,
  Card,
  ErrorState,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  notify,
} from '@nittcam/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PageHeader, pageContainer } from '../../../components/page/page-header';
import { fill } from '../../../lib/draft-project';
import {
  layerRowErrors,
  layerRowsToMap,
  mapToLayerRows,
  type LayerRow,
} from '../../../lib/dxf-layer-editor';
import type { Messages } from '../../../lib/messages';

type Text = Messages['settings'];
type OpsText = Messages['dxfImport']['layers']['ops'];

/** `auto` is what an unlisted layer gets; the editor lists only real choices. */
const EDITOR_OPS = DXF_LAYER_OPS.filter((op) => op !== 'auto');

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready' };

/**
 * Ayarlar → DXF katmanları (T182, spec §4.6 "Eşleme şirket ayarı olarak saklanır"): the
 * company's layer → operation mapping as an editable list. Saving replaces the whole mapping;
 * the DXF import keeps adding its own choices to it (T145).
 */
export function DxfLayersView({ t, ops }: { t: Text; ops: OpsText }) {
  const d = t.dxf;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [rows, setRows] = useState<LayerRow[]>([]);
  const [saved, setSaved] = useState<DxfLayerMap>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const newId = () => `r${(nextId.current += 1)}`;

  const fetchMap = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const res = await fetch('/api/settings/dxf-layers', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const { map } = (await res.json()) as { map: DxfLayerMap };
      setSaved(map);
      setRows(mapToLayerRows(map, () => `r${(nextId.current += 1)}`));
      setLoad({ status: 'ready' });
    } catch {
      setLoad({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // Initial fetch; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMap();
  }, [fetchMap]);

  const errors = layerRowErrors(rows);
  const map = layerRowsToMap(rows);
  const dirty = JSON.stringify(map) !== JSON.stringify(saved) || rows.some((r) => !r.name.trim());

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      notify.error(d.hasErrors);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/settings/dxf-layers', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ map }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { map: DxfLayerMap };
      setSaved(body.map);
      setRows(mapToLayerRows(body.map, newId));
      setSubmitted(false);
      notify.success(d.saved);
    } catch {
      notify.error(d.failed);
    } finally {
      setBusy(false);
    }
  }

  function update(id: string, patch: Partial<LayerRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function add() {
    const id = newId();
    setRows((rs) => [...rs, { id, name: '', op: 'outside' }]);
    requestAnimationFrame(() => document.getElementById(`layer-${id}`)?.focus());
  }

  const errorText = (id: string) => {
    const e = submitted || rows.find((r) => r.id === id)?.name ? errors[id] : undefined;
    return e === 'empty' ? d.emptyName : e === 'duplicate' ? d.duplicate : null;
  };

  return (
    <main className={`${pageContainer} gap-6`} data-testid="settings-dxf">
      <PageHeader title={d.title} description={d.subtitle} />
      {load.status === 'loading' ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : load.status === 'error' ? (
        <ErrorState title={t.loadError} onRetry={() => void fetchMap()} retryLabel={t.retry} />
      ) : (
        <form onSubmit={(ev) => void save(ev)} noValidate className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5 sm:p-6">
            <p className="text-sm text-fg-muted">{d.hint}</p>
            {rows.length === 0 ? (
              <p className="text-sm text-fg-muted" data-testid="dxf-layers-empty">
                {d.empty}
              </p>
            ) : (
              <table className="w-full text-left text-sm" data-testid="dxf-layers-table">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 text-xs font-medium text-fg-muted">
                      {d.layer}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-xs font-medium text-fg-muted">
                      {d.op}
                    </th>
                    <th scope="col" className="w-10 py-2">
                      <span className="sr-only">{d.remove.replace(': {name}', '')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {rows.map((r) => {
                    const err = errorText(r.id);
                    return (
                      <tr key={r.id} data-testid="dxf-layer-row" className="align-top">
                        <td className="py-2 pr-3">
                          <Input
                            id={`layer-${r.id}`}
                            inputSize="sm"
                            aria-label={d.layer}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? `layer-${r.id}-error` : undefined}
                            data-testid="dxf-layer-name"
                            value={r.name}
                            maxLength={255}
                            onChange={(e) => update(r.id, { name: e.target.value })}
                          />
                          {err ? (
                            <p
                              id={`layer-${r.id}-error`}
                              className="mt-1 text-xs text-danger-text"
                              data-testid="dxf-layer-error"
                            >
                              {err}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">
                          <Select
                            value={r.op}
                            onValueChange={(op) => update(r.id, { op: op as DxfLayerOp })}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`${d.op}: ${r.name || d.layer}`}
                              data-testid="dxf-layer-op"
                              data-value={r.op}
                              className="min-w-44"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EDITOR_OPS.map((op) => (
                                <SelectItem key={op} value={op}>
                                  {ops[op]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {r.op === 'pocket' ? (
                            <p className="mt-1 text-xs text-fg-muted">{d.pocketSoon}</p>
                          ) : null}
                        </td>
                        <td className="py-2">
                          <IconButton
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={
                              r.name.trim()
                                ? fill(d.remove, { name: r.name.trim() })
                                : d.removeUnnamed
                            }
                            data-testid="dxf-layer-remove"
                            onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                          >
                            <Trash2 aria-hidden />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={add}
                disabled={rows.length >= MAX_DXF_LAYER_MAP}
                data-testid="dxf-layer-add"
              >
                <Plus aria-hidden />
                {d.add}
              </Button>
              <span className="text-xs text-fg-muted">
                {fill(d.count, { n: Object.keys(map).length })}
              </span>
            </div>
          </Card>
          <Button
            type="submit"
            className="self-start"
            loading={busy}
            disabled={busy || !dirty}
            data-testid="dxf-layers-save"
          >
            {d.save}
          </Button>
        </form>
      )}
    </main>
  );
}
