import { notFound } from 'next/navigation';
import { UiGallery } from '../../../components/dev/ui-gallery';
import { isGalleryEnabled } from '../../../lib/dev-gallery';
import { getMessages } from '../../../lib/messages';

// Dev-only UI gallery (T102, D-032): every component, variant and state; the screenshot and axe
// surface of the `visual` Playwright project. Hidden in production unless the server runs with
// NITTCAM_UI_GALLERY=1 (the e2e server does). Read per request, so one build serves both.
export const dynamic = 'force-dynamic';

export const metadata = { robots: { index: false, follow: false } };

export default function DevUiPage() {
  if (!isGalleryEnabled()) notFound();
  return <UiGallery t={getMessages().devUi} />;
}
