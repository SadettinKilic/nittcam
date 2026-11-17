import type { VerificationState } from '@nittcam/core';
import { Badge } from '@nittcam/ui';
import type { ComponentProps } from 'react';
import { STATE_TONE } from '../../lib/machine-state';

/** Verification badge of a machine (spec §7.3): Taslak … Doğrulanmış, Yeniden doğrulama gerekli. */
export function MachineStateBadge({
  state,
  label,
  ...props
}: { state: VerificationState; label: string } & Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <Badge variant={STATE_TONE[state]} dot {...props}>
      {label}
    </Badge>
  );
}
