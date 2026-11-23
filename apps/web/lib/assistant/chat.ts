/**
 * AI chat shell (T314, D-102). The panel shows the conversation; the answer comes from one
 * `AssistantResponder`. Until M11 (behind Q001) the only responder is `comingSoonResponder`: a fixed
 * Turkish text, no AI, no network, no project change. M11 replaces the responder (a server call
 * with command proposals and "Uygula / İptal", spec §5.2–5.4); the panel stays.
 */

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  /** Stable key for the list (session counter, not a database id). */
  id: string;
  role: ChatRole;
  text: string;
}

/** What a responder sees: the new message and the conversation before it. */
export interface AssistantRequest {
  text: string;
  history: readonly ChatMessage[];
}

/** One reply per user message. Async so the real (server) responder fits the same slot. */
export type AssistantResponder = (request: AssistantRequest) => Promise<string>;

/** The placeholder responder: always the same reply, whatever was written. */
export function comingSoonResponder(reply: string): AssistantResponder {
  return () => Promise.resolve(reply);
}

/** Trimmed message text, or `null` when there is nothing to send. */
export function normalizeInput(raw: string): string | null {
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

/** Appends a message with the next session id (immutable). */
export function appendMessage(
  list: readonly ChatMessage[],
  role: ChatRole,
  text: string,
): ChatMessage[] {
  return [...list, { id: `m${list.length + 1}`, role, text }];
}
