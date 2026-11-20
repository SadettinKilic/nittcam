import { Badge } from '@nittcam/ui';
import { Wrench } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { MaintenanceView } from '../../lib/maintenance';

/** Maintenance reminder (T181): "Bakım gecikti" / "Bakım yaklaşıyor" with the due date. */
export function MaintenanceBadge({
  view,
  ...props
}: { view: MaintenanceView } & Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <Badge
      variant={view.tone}
      data-state={view.status.state}
      title={view.detail || undefined}
      {...props}
    >
      <Wrench aria-hidden />
      {view.label}
      {view.detail ? <span className="sr-only">: {view.detail}</span> : null}
    </Badge>
  );
}
