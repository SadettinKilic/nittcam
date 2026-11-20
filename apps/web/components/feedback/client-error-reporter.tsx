'use client';

import { useEffect } from 'react';
import { reportClientError } from '../../lib/report-client-error';

/** Sends uncaught errors and unhandled promise rejections to the server log (T187). */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError('error', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError('rejection', e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
