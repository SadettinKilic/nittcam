'use client';

import { Skeleton } from '@nittcam/ui';
import dynamic from 'next/dynamic';

/**
 * The heavy wizard step bodies load on demand (T186, spec §8.2): the drawing editor, Dizilim,
 * Simülasyon and Dışa aktar each pull a large part of the core kernel, so a project page loads
 * only the step it opens. `preloadWizardSteps` fetches the rest once the page has loaded, so
 * switching steps stays instant.
 */
function StepLoading() {
  return (
    <div role="status" aria-busy="true" data-testid="step-loading" className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

const loadDrawingBoard = () => import('../editor/drawing-board');
const loadLayoutStep = () => import('./layout-step');
const loadSimulationView = () => import('../simulation/simulation-view');
const loadExportStep = () => import('./export-step');

export const DrawingBoard = dynamic(() => loadDrawingBoard().then((m) => m.DrawingBoard), {
  loading: StepLoading,
});
export const LayoutStep = dynamic(() => loadLayoutStep().then((m) => m.LayoutStep), {
  loading: StepLoading,
});
export const SimulationView = dynamic(() => loadSimulationView().then((m) => m.SimulationView), {
  loading: StepLoading,
});
/** T387: the montaj tezgâhı (three + the bench) loads only when the Montaj view opens; not preloaded. */
export const AssemblyBench = dynamic(
  () => import('../assembly/assembly-bench').then((m) => m.AssemblyBench),
  { loading: StepLoading, ssr: false },
);
export const ExportStep = dynamic(() => loadExportStep().then((m) => m.ExportStep), {
  loading: StepLoading,
});
/**
 * Simülasyon's cutting settings (B60 round 38, B42 wizard budget): they render inside the lazy
 * simulation view, so they load with it instead of with every wizard page.
 */
export const CuttingSettings = dynamic(() =>
  import('../simulation/cutting-settings').then((m) => m.CuttingSettings),
);
/**
 * B60: the "changes left behind" notice is rare and pulls the alert dialog; it loads only when a
 * page has parked changes (B42 wizard budget, D-079).
 */
export const ParkedChangesNotice = dynamic(() =>
  import('./parked-changes').then((m) => m.ParkedChangesNotice),
);

let preloaded = false;

/** Fetches every step chunk after the page's `load` event (once per page life). */
export function preloadWizardSteps(): void {
  if (preloaded || typeof window === 'undefined') return;
  preloaded = true;
  const run = () => {
    for (const load of [loadLayoutStep, loadSimulationView, loadExportStep, loadDrawingBoard]) {
      void load().catch(() => undefined);
    }
  };
  const later = () => window.setTimeout(run, 500);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
