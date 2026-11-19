'use client';

import {
  Button,
  FormField,
  GrainDial,
  Input,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@nittcam/ui';
import { useState } from 'react';
import { EDGES, bulkParams, type EdgeKey, type GrainChoice } from '../../lib/cut-list-grid';
import { fill } from '../../lib/draft-project';
import { grainDialLabels } from '../../lib/grain-labels';
import type { Text } from './cut-list-cells';

const noEdges = (): Record<EdgeKey, number | null> => ({
  top: null,
  right: null,
  bottom: null,
  left: null,
});

/**
 * Bulk edit of the selected rows (T119, spec §4.1): quantity, grain, edge bands and a name
 * prefix; empty fields stay as they are. "Uygula" runs one `updateParts` command (one undo step).
 */
export function BulkEditSheet({
  t,
  open,
  onOpenChange,
  ids,
  onApply,
}: {
  t: Text;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: readonly string[];
  /** Runs `updateParts`; false when it was rejected. */
  onApply: (params: Record<string, unknown>) => boolean;
}) {
  const b = t.bulk;
  const [qty, setQty] = useState<number | null>(null);
  const [grain, setGrain] = useState<GrainChoice>('__keep__');
  const [angle, setAngle] = useState(0);
  const [edges, setEdges] = useState(noEdges);
  const [prefix, setPrefix] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQty(null);
    setGrain('__keep__');
    setAngle(0);
    setEdges(noEdges());
    setPrefix('');
    setError(null);
  }

  function apply() {
    const params = bulkParams(ids, { qty, grain, angle, edges, prefix });
    if (!params) {
      setError(b.nothing);
      return;
    }
    if (onApply(params)) {
      reset();
      onOpenChange(false);
    } else {
      setError(t.errors.rejected);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <SheetContent
        side="right"
        closeLabel={b.close}
        data-testid="bulk-edit"
        data-density="compact"
      >
        <SheetHeader>
          <SheetTitle>{b.title}</SheetTitle>
          <SheetDescription>{fill(b.description, { count: ids.length })}</SheetDescription>
        </SheetHeader>
        {/* A form, so Enter in any field applies (like the other dialogs). */}
        <form
          className="contents"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <SheetBody className="flex flex-col gap-5 py-5">
            <FormField label={b.qty} id="bulk-qty">
              <NumberInput
                value={qty}
                onValueChange={setQty}
                min={1}
                step={1}
                maxDecimals={0}
                data-testid="bulk-qty"
              />
            </FormField>
            <div className="flex flex-col gap-2">
              <label htmlFor="bulk-grain" className="text-sm font-medium text-fg">
                {b.grain}
              </label>
              <Select value={grain} onValueChange={(v) => setGrain(v as GrainChoice)}>
                <SelectTrigger id="bulk-grain" data-testid="bulk-grain" data-value={grain}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep__">{b.grainKeep}</SelectItem>
                  <SelectItem value="free">{b.grainFree}</SelectItem>
                  <SelectItem value="fixed">{b.grainFixed}</SelectItem>
                </SelectContent>
              </Select>
              {grain === 'fixed' ? (
                <GrainDial
                  value={angle}
                  onValueChange={setAngle}
                  onValueCommit={setAngle}
                  labels={grainDialLabels()}
                  data-testid="bulk-grain-dial"
                />
              ) : null}
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-fg">{b.edges}</legend>
              <div className="grid grid-cols-2 gap-3">
                {EDGES.map((edge) => (
                  <FormField key={edge} label={t.edge[edge]} id={`bulk-edge-${edge}`}>
                    <NumberInput
                      value={edges[edge]}
                      onValueChange={(v) => setEdges((cur) => ({ ...cur, [edge]: v }))}
                      min={0}
                      step={0.1}
                      placeholder={b.edgeKeep}
                      data-testid={`bulk-edge-${edge}`}
                    />
                  </FormField>
                ))}
              </div>
            </fieldset>
            <FormField label={b.prefix} hint={b.prefixHint} id="bulk-prefix">
              <Input
                value={prefix}
                maxLength={60}
                onChange={(e) => setPrefix(e.target.value)}
                data-testid="bulk-prefix"
              />
            </FormField>
            {error ? (
              <p role="alert" className="text-sm font-medium text-danger-text">
                {error}
              </p>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {b.cancel}
            </Button>
            <Button type="submit" data-testid="bulk-apply">
              {b.apply}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
