'use client';

import { IconButton, Tooltip, cn } from '@nittcam/ui';
import { Box, Square } from 'lucide-react';
import type { Messages } from '../../lib/messages';
import type { ViewMode } from '../../lib/preview3d/view-memory';

/** Compact 2D / 3D icon switch of a preview panel (T152 look; T160 wizard panels). */
export function ViewSwitch({
  t,
  mode,
  onChoose,
}: {
  t: Messages['layout']['preview3d'];
  mode: ViewMode;
  onChoose: (m: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label={t.switchLabel}
      className="flex items-center gap-px rounded-md bg-surface-subtle p-px"
      data-testid="view-switch"
    >
      {(['2d', '3d'] as const).map((m) => (
        <Tooltip key={m} content={m === '2d' ? t.view2dTip : t.view3dTip}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={m === '2d' ? t.view2dTip : t.view3dTip}
            aria-pressed={mode === m}
            data-testid={`view-${m}`}
            onClick={() => onChoose(m)}
            className={cn('size-7', mode === m && 'bg-surface text-fg shadow-xs hover:bg-surface')}
          >
            {m === '2d' ? <Square aria-hidden /> : <Box aria-hidden />}
          </IconButton>
        </Tooltip>
      ))}
    </div>
  );
}
