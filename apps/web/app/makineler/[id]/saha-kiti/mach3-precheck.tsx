import { mach3PreCheckItems } from '../../../../lib/mach3-precheck';
import type { Messages } from '../../../../lib/messages';

type Text = Messages['fieldKit']['mach3'];

/**
 * T332 rider (PO, docs/machines/controllers/mach3-saha-kontrol.md): the Mach3 settings that can
 * ruin a first run, one line each with the Mach3 menu path, to check before the air cut. Shown
 * only when the machine's post is `mach3`; printed with the rest of the field kit.
 */
export function Mach3PreCheck({ t, postId }: { t: Text; postId: string | null | undefined }) {
  const items = mach3PreCheckItems(postId, t);
  if (!items) return null;
  return (
    <section
      aria-label={t.title}
      data-testid="field-kit-mach3"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold tracking-tight text-fg">{t.title}</h2>
      <p className="text-sm text-fg-muted">{t.intro}</p>
      <ul className="flex flex-col gap-2 text-sm text-fg">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2" data-testid="field-kit-mach3-item">
            <span
              aria-hidden
              className="mt-0.5 inline-flex size-4 shrink-0 rounded-sm border border-border-strong"
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
