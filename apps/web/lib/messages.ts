import tr from '../messages/tr.json';

/** UI text lives in translation files (ui-conventions). Turkish first; English later. */
export type Messages = typeof tr;

export const defaultLocale = 'tr';

export function getMessages(): Messages {
  return tr;
}
