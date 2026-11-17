import { redirect } from 'next/navigation';

/** Old standalone simulation page (T020): now step 4 of the wizard (T023). */
export default function SimulationPage() {
  redirect('/projeler/yeni?adim=simulasyon');
}
