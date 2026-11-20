import tr from '../messages/tr.json';
import trError from '../messages/tr-error.json';

/**
 * UI text lives in translation files (ui-conventions). Turkish first; English later.
 * `tr-error.json` holds the error-page text on its own (T186): `app/error.tsx` and
 * `app/global-error.tsx` ship with every route, and importing the whole `tr.json` there put
 * all UI text into every page's JavaScript. `getMessages()` still returns it as `feedback.error`.
 */
const messages = { ...tr, feedback: { ...tr.feedback, error: trError } };

export type Messages = typeof messages;

export const defaultLocale = 'tr';

export function getMessages(): Messages {
  return messages;
}
