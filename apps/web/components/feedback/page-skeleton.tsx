import { Skeleton } from '@nittcam/ui';

/**
 * Loading placeholder for a whole page (T105): heading, toolbar and content blocks in the shape
 * of the page that is coming. `label` is announced to screen readers.
 */
export function PageSkeleton({
  label,
  variant = 'list',
  testId = 'page-skeleton',
}: {
  label: string;
  variant?: 'list' | 'split';
  testId?: string;
}) {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6"
      aria-busy="true"
    >
      <div role="status" data-testid={testId} className="flex flex-col gap-6">
        <span className="sr-only">{label}</span>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-56 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        {variant === 'split' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
            <Skeleton className="h-80 w-full rounded-xl" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full max-w-sm" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
