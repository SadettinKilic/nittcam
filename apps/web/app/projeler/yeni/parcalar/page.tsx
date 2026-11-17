import { redirect } from 'next/navigation';

/** Old standalone parts page (T011–T013): now step 2 of the wizard (T023). */
export default function PartsPage() {
  redirect('/projeler/yeni?adim=parcalar');
}
