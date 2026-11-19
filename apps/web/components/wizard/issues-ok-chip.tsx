import { CircleCheck } from 'lucide-react';

/**
 * "Sorun yok" chip (T246, T252): stands in for the Uyarılar card in a card header while the
 * project has no issues. Status text, not a control.
 */
export function IssuesOkChip({ label, testId }: { label: string; testId: string }) {
  return (
    <span
      data-testid={testId}
      data-count={0}
      className="inline-flex h-6 items-center gap-1 rounded-sm border border-success-border bg-success-subtle px-2 text-xs font-medium whitespace-nowrap text-success-text"
    >
      <CircleCheck aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
