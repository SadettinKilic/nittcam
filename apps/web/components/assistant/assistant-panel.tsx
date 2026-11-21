'use client';

import { Badge, IconButton, Input, cn } from '@nittcam/ui';
import { SendHorizontal, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  appendMessage,
  comingSoonResponder,
  normalizeInput,
  type AssistantResponder,
  type ChatMessage,
} from '../../lib/assistant/chat';
import type { AssistantText } from './assistant-launcher';

/**
 * The chat panel (T314, D-102). A non-modal dialog in the bottom-right corner: the drawing stays
 * usable behind it. Focus goes to the message field on open, Esc closes, replies are announced
 * through a polite live region. The answer comes from `respond` (default: the fixed "yakında"
 * text); M11 passes the real responder here. Nothing touches the project.
 */
export function AssistantPanel({
  t,
  className,
  messages,
  onMessages,
  onClose,
  respond: respondProp,
}: {
  t: AssistantText;
  className?: string;
  messages: ChatMessage[];
  onMessages: (update: (list: ChatMessage[]) => ChatMessage[]) => void;
  onClose: () => void;
  respond?: AssistantResponder;
}) {
  const titleId = useId();
  const introId = useId();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState('');
  const respond = useMemo(
    () => respondProp ?? comingSoonResponder(t.reply),
    [respondProp, t.reply],
  );

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Newest message in view (instant scroll, no motion).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = normalizeInput(draft);
    if (!text || pending) return;
    const history = messages;
    setDraft('');
    onMessages((l) => appendMessage(l, 'user', text));
    setPending(true);
    try {
      const reply = await respond({ text, history });
      onMessages((l) => appendMessage(l, 'assistant', reply));
      setAnnounce(reply);
    } finally {
      setPending(false);
      input.current?.focus();
    }
  }

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={introId}
      data-testid="assistant-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        'z-40 flex max-h-[min(32rem,calc(100dvh-10rem))] w-[min(24rem,calc(100vw-2rem))] animate-pop-in flex-col rounded-xl border border-border bg-surface-raised shadow-lg',
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-border-subtle py-2 pr-2 pl-4">
        <h2 id={titleId} className="text-sm font-semibold">
          {t.title}
        </h2>
        <Badge variant="accent" data-testid="assistant-soon">
          {t.soon}
        </Badge>
        <IconButton
          size="sm"
          aria-label={t.close}
          data-testid="assistant-close"
          className="ml-auto"
          onClick={onClose}
        >
          <X aria-hidden />
        </IconButton>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4"
        ref={scroller}
      >
        <p id={introId} className="text-sm text-fg-muted">
          {t.intro}
        </p>
        {messages.length > 0 ? (
          <ol aria-label={t.log} data-testid="assistant-messages" className="flex flex-col gap-2">
            {messages.map((m) => (
              <li
                key={m.id}
                data-role={m.role}
                className={cn(
                  'max-w-[85%] min-w-0 rounded-lg [overflow-wrap:anywhere] whitespace-pre-wrap px-3 py-2 text-sm',
                  m.role === 'user'
                    ? 'self-end bg-accent-subtle text-fg'
                    : 'self-start border border-border-subtle bg-surface text-fg',
                )}
              >
                <span className="sr-only">{m.role === 'user' ? t.you : t.bot}: </span>
                {m.text}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div aria-live="polite" role="status" className="sr-only" data-testid="assistant-live">
        {announce}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-border-subtle p-3">
        <label htmlFor={inputId} className="sr-only">
          {t.inputLabel}
        </label>
        <Input
          ref={input}
          id={inputId}
          data-testid="assistant-input"
          autoComplete="off"
          placeholder={t.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1"
        />
        <IconButton
          type="submit"
          variant="primary"
          aria-label={t.send}
          data-testid="assistant-send"
          disabled={pending || normalizeInput(draft) === null}
        >
          <SendHorizontal aria-hidden />
        </IconButton>
      </form>
    </section>
  );
}
