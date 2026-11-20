'use client';

import type { TemplateParams } from '@nittcam/core';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Input,
  NumberInput,
  Skeleton,
  Switch,
  notify,
} from '@nittcam/ui';
import {
  Archive,
  ArchiveRestore,
  Copy,
  History,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PageHeader, pageContainer } from '../../components/page/page-header';
import { Callout } from '../../components/wizard/panels';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import {
  addTemplateVersion,
  createTemplate,
  fetchTemplateVersions,
  fetchTemplates,
  setTemplateArchived,
  type TemplateItem,
} from '../../lib/templates-api';
import {
  commonSpan,
  duplicateDraft,
  editedDraft,
  isChanged,
  scaledBox,
  splitTemplates,
  templatePreview,
} from '../../lib/templates-page';

type Text = Messages['templatesPage'];

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: TemplateItem[] };

const num = (n: number) => String(n).replace('.', ',');

export function TemplatesView({ t }: { t: Text }) {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<TemplateItem | null>(null);
  const [history, setHistory] = useState<TemplateItem | null>(null);
  const switchId = useId();

  const load = useCallback(async (archived: boolean) => {
    setList({ status: 'loading' });
    const items = await fetchTemplates({ archived });
    setList(items ? { status: 'ready', items } : { status: 'error' });
  }, []);

  useEffect(() => {
    // Initial fetch; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(showArchived);
  }, [load, showArchived]);

  async function duplicate(item: TemplateItem): Promise<void> {
    const created = await createTemplate(
      duplicateDraft(item, (name) => fill(t.copyName, { name })),
    );
    if (!created) {
      notify.error(t.toast.failed);
      return;
    }
    notify.success(fill(t.toast.duplicated, { name: created.name }));
    void load(showArchived);
  }

  async function archive(item: TemplateItem, archived: boolean): Promise<void> {
    const done = await setTemplateArchived(item.id, archived);
    if (!done) {
      notify.error(t.toast.failed);
      return;
    }
    notify.success(fill(archived ? t.toast.archived : t.toast.restored, { name: item.name }));
    void load(showArchived);
  }

  const actions = { onEdit: setEditing, onHistory: setHistory, duplicate, archive };

  return (
    <main className={`${pageContainer} gap-6`}>
      <PageHeader
        title={t.title}
        description={t.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              data-testid="templates-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <label htmlFor={switchId} className="text-sm text-fg">
              {t.showArchived}
            </label>
          </div>
        }
      />

      {list.status === 'loading' ? (
        <div role="status" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">{t.loading}</span>
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : list.status === 'error' ? (
        <ErrorState
          title={t.loadError}
          onRetry={() => void load(showArchived)}
          retryLabel={t.retry}
        />
      ) : (
        <Lists t={t} items={list.items} actions={actions} />
      )}

      {editing ? (
        <EditDialog
          t={t}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load(showArchived);
          }}
        />
      ) : null}
      {history ? <HistoryDialog t={t} item={history} onClose={() => setHistory(null)} /> : null}
    </main>
  );
}

interface Actions {
  onEdit: (item: TemplateItem) => void;
  onHistory: (item: TemplateItem) => void;
  duplicate: (item: TemplateItem) => Promise<void>;
  archive: (item: TemplateItem, archived: boolean) => Promise<void>;
}

function Lists({ t, items, actions }: { t: Text; items: TemplateItem[]; actions: Actions }) {
  const { company, ready } = splitTemplates(items);
  // P4: one drawing scale for every thumbnail on the page.
  const span = commonSpan(items.map((i) => templatePreview(i).box));
  return (
    <>
      <section aria-labelledby="tpl-company" className="flex flex-col gap-3">
        <h2 id="tpl-company" className="text-lg font-semibold text-fg">
          {t.company}
        </h2>
        {company.length === 0 ? (
          <EmptyState icon={<LayoutTemplate />} title={t.company} description={t.empty} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="templates-company">
            {company.map((item) => (
              <TemplateCard key={item.id} t={t} item={item} actions={actions} span={span} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="tpl-ready" className="flex flex-col gap-3">
        <h2 id="tpl-ready" className="text-lg font-semibold text-fg">
          {t.ready}
        </h2>
        <Callout tone="warning" data-testid="templates-ready-note">
          <p>{t.readyNote}</p>
        </Callout>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="templates-ready">
          {ready.map((item) => (
            <TemplateCard key={item.id} t={t} item={item} actions={actions} span={span} />
          ))}
        </ul>
      </section>
    </>
  );
}

function TemplateCard({
  t,
  item,
  actions,
  span,
}: {
  t: Text;
  item: TemplateItem;
  actions: Actions;
  span: { w: number; h: number };
}) {
  const { params } = item;
  // The chosen action runs once the menu has fully closed (onCloseAutoFocus), so a dialog never
  // opens over a menu that is still animating out (Radix would leave it stuck in the page).
  const [menuOpen, setMenuOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const run = (fn: () => void) => {
    pending.current = fn;
    setMenuOpen(false);
  };
  return (
    <li data-testid="template-card" data-id={item.id}>
      <Card className="flex h-full flex-col gap-3 p-4">
        <Preview t={t} item={item} span={span} />
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="truncate font-medium text-fg" title={item.name}>
              {item.name}
            </h3>
            <p className="text-sm text-fg-muted" data-testid="template-card-version">
              {fill(t.version, { v: item.version })}
            </p>
          </div>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={fill(t.actions.label, { name: item.name })}
                data-testid="template-card-menu"
              >
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                const fn = pending.current;
                pending.current = null;
                if (!fn) return;
                // the dialog takes focus itself
                e.preventDefault();
                fn();
              }}
            >
              {!item.ready ? (
                <DropdownMenuItem
                  data-testid="template-edit"
                  onSelect={() => run(() => actions.onEdit(item))}
                >
                  <Pencil aria-hidden />
                  {t.actions.edit}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                data-testid="template-history"
                onSelect={() => run(() => actions.onHistory(item))}
              >
                <History aria-hidden />
                {t.actions.history}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="template-duplicate"
                onSelect={() => run(() => void actions.duplicate(item))}
              >
                <Copy aria-hidden />
                {t.actions.duplicate}
              </DropdownMenuItem>
              {!item.ready ? (
                <DropdownMenuItem
                  data-testid={item.archived ? 'template-restore' : 'template-archive'}
                  onSelect={() => run(() => void actions.archive(item, !item.archived))}
                >
                  {item.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  {item.archived ? t.actions.restore : t.actions.archive}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="text-sm text-fg-muted tabular-nums" data-testid="template-card-summary">
          {fill(t.summary, {
            count: params.count,
            spacing: num(params.spacing),
            edge: num(params.edgeDistance),
          })}
        </p>
        <div className="mt-auto flex flex-wrap gap-1.5">
          {item.ready ? <Badge variant="info">{t.badges.ready}</Badge> : null}
          {item.verified === false ? <Badge variant="warning">{t.badges.unverified}</Badge> : null}
          {item.archived ? <Badge variant="neutral">{t.badges.archived}</Badge> : null}
        </div>
      </Card>
    </li>
  );
}

/** Thumbnail: the holes, contours and lines of every copy, with the reference edge (dashed). */
function Preview({
  t,
  item,
  span,
}: {
  t: Text;
  item: TemplateItem;
  span: { w: number; h: number };
}) {
  const p = templatePreview(item);
  const [x, y, w, h] = scaledBox(p.box, span);
  const stroke = Math.max(w, h) / 160;
  return (
    <svg
      role="img"
      aria-label={fill(t.preview, { name: item.name })}
      data-testid="template-preview"
      viewBox={`${x} ${-(y + h)} ${w} ${h}`}
      className="h-28 w-full rounded-md border border-border-subtle bg-surface-subtle text-fg"
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform="scale(1,-1)" fill="none" stroke="currentColor" strokeWidth={stroke}>
        <line
          x1={p.edgeX}
          y1={y}
          x2={p.edgeX}
          y2={y + h}
          strokeDasharray={`${stroke * 4} ${stroke * 3}`}
          className="text-fg-muted"
        />
        {p.circles.map((c, i) => (
          <circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} />
        ))}
        {p.paths.map((d, i) => (
          <path key={`p${i}`} d={d} />
        ))}
      </g>
    </svg>
  );
}

function EditDialog({
  t,
  item,
  onClose,
  onSaved,
}: {
  t: Text;
  item: TemplateItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const e = t.edit;
  const [name, setName] = useState(item.name);
  const [count, setCount] = useState<number | null>(item.params.count);
  const [spacing, setSpacing] = useState<number | null>(item.params.spacing);
  const [edge, setEdge] = useState<number | null>(item.params.edgeDistance);
  const [d, setD] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(item.geometry.holes.map((h) => [h.id, item.params.d[h.id] ?? h.d])),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function params(): TemplateParams | null {
    if (count === null || spacing === null || edge === null || name.trim() === '') return null;
    const overrides: Record<string, number> = {};
    for (const h of item.geometry.holes) {
      const v = d[h.id];
      if (v === null || v === undefined || !(v > 0)) return null;
      // keep the stored shape: an override only where it differs from the hole's own diameter
      if (v !== h.d || item.params.d[h.id] !== undefined) overrides[h.id] = v;
    }
    return { count, spacing, edgeDistance: edge, d: overrides };
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    const next = params();
    if (!next) return setMessage(e.invalid);
    if (!isChanged(item, name, next)) return setMessage(e.unchanged);
    setBusy(true);
    const saved = await addTemplateVersion(item.id, editedDraft(item, name, next));
    setBusy(false);
    if (!saved) return setMessage(t.toast.failed);
    notify.success(fill(t.toast.saved, { name: saved.name, v: saved.version }));
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg" data-testid="template-edit-dialog">
        <form onSubmit={(ev) => void save(ev)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{fill(e.title, { name: item.name })}</DialogTitle>
            <DialogDescription>{fill(e.description, { v: item.version + 1 })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={e.name} className="sm:col-span-2">
              <Input
                data-testid="template-edit-name"
                value={name}
                maxLength={80}
                onChange={(ev) => setName(ev.target.value)}
              />
            </FormField>
            <FormField label={e.count}>
              <NumberInput
                data-testid="template-edit-count"
                value={count}
                onValueChange={setCount}
                min={1}
                max={50}
                maxDecimals={0}
              />
            </FormField>
            <FormField label={e.spacing}>
              <NumberInput
                data-testid="template-edit-spacing"
                value={spacing}
                onValueChange={setSpacing}
                min={0}
                unit="mm"
              />
            </FormField>
            <FormField label={e.edgeDistance}>
              <NumberInput
                data-testid="template-edit-edge"
                value={edge}
                onValueChange={setEdge}
                min={0}
                unit="mm"
              />
            </FormField>
            {item.geometry.holes.map((h) => (
              <FormField key={h.id} label={fill(e.diameter, { id: h.id })}>
                <NumberInput
                  data-testid={`template-edit-d-${h.id}`}
                  value={d[h.id] ?? null}
                  onValueChange={(v) => setD((x) => ({ ...x, [h.id]: v }))}
                  min={0.1}
                  unit="mm"
                />
              </FormField>
            ))}
          </div>
          {message ? (
            <p
              role="alert"
              className="text-sm text-danger-text"
              data-testid="template-edit-message"
            >
              {message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {e.cancel}
            </Button>
            <Button type="submit" disabled={busy} data-testid="template-edit-save">
              {e.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ t, item, onClose }: { t: Text; item: TemplateItem; onClose: () => void }) {
  const [versions, setVersions] = useState<TemplateItem[] | null | 'error'>(null);
  useEffect(() => {
    void fetchTemplateVersions(item.id).then((v) => setVersions(v ?? 'error'));
  }, [item.id]);
  const date = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg" data-testid="template-history-dialog">
        <DialogHeader>
          <DialogTitle>{fill(t.history.title, { name: item.name })}</DialogTitle>
        </DialogHeader>
        {versions === null ? (
          <p role="status" className="text-sm text-fg-muted">
            {t.history.loading}
          </p>
        ) : versions === 'error' ? (
          <p role="alert" className="text-sm text-danger-text">
            {t.history.loadError}
          </p>
        ) : (
          <ol
            className="flex flex-col divide-y divide-border-subtle"
            data-testid="template-versions"
          >
            {[...versions].reverse().map((v) => (
              <li
                key={v.version}
                className="flex flex-col gap-0.5 py-2"
                data-testid="template-version"
              >
                <span className="font-medium text-fg">
                  {fill(t.version, { v: v.version })}
                  {v.createdAt ? (
                    <span className="ml-2 text-sm font-normal text-fg-muted">
                      {date(v.createdAt)}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-fg-muted tabular-nums">
                  {v.name} ·{' '}
                  {fill(t.summary, {
                    count: v.params.count,
                    spacing: num(v.params.spacing),
                    edge: num(v.params.edgeDistance),
                  })}
                </span>
              </li>
            ))}
          </ol>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t.history.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
