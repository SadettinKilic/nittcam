'use client';

import { Button } from '@nittcam/ui';
import { MessageSquareText } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage } from '../../lib/assistant/chat';
import type { Messages } from '../../lib/messages';

export type AssistantText = Messages['wizard']['assistant'];

/**
 * AI chat entry point on the project screen (T314, D-102; spec §5.2: bottom right, opens and
 * closes). The button sits in the wizard's bottom step bar, so it never covers the drawing or a
 * control; the panel floats above that bar in the bottom-right corner. Only this button ships
 * with the wizard; the panel loads on the first open (T186 page JS budget). The conversation
 * lives in this component's state: it survives closing and reopening on the page and is gone on
 * reload (nothing is stored or sent).
 */
const AssistantPanel = dynamic(() => import('./assistant-panel').then((m) => m.AssistantPanel), {
  ssr: false,
});

/** Above the wizard footer (sticky step bar), in the bottom-right corner. */
const CORNER = 'fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:right-6';

export function AssistantLauncher({ t }: { t: AssistantText }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const button = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the button that opened the panel.
    button.current?.focus();
  }, []);

  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        data-testid="assistant-open"
        title={t.openLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="max-sm:size-10 max-sm:px-0"
      >
        <MessageSquareText aria-hidden />
        <span className="max-sm:sr-only">{t.open}</span>
      </Button>
      {/* Portalled: the step bar has a backdrop filter, which would trap a fixed child. */}
      {open
        ? createPortal(
            <AssistantPanel
              t={t}
              className={CORNER}
              messages={messages}
              onMessages={setMessages}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </>
  );
}
