import { redirect } from 'next/navigation';
import { SETTINGS_HREF } from '../../lib/shell-nav';

/** Ayarlar has one page so far (T121). */
export default function SettingsPage() {
  redirect(SETTINGS_HREF);
}
