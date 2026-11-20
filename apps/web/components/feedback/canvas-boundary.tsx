'use client';

import { reportClientError } from '../../lib/report-client-error';
import { ErrorState } from '@nittcam/ui';
import { ImageOff } from 'lucide-react';
import { Component, type ContextType, type ErrorInfo, type ReactNode } from 'react';
import { MessagesContext } from '../../lib/messages-context';
import { ThrowProbe } from './throw-probe';

export interface CanvasBoundaryProps {
  /** Defaults to the Turkish texts of `feedback.canvas` (from `MessagesContext`). */
  t?: { title: string; text: string; retry: string };
  children: ReactNode;
  /** Optional test id of the fallback. */
  testId?: string;
}

/**
 * Error boundary around canvases (T105): a crash in Konva/3D code shows a Turkish fallback with a
 * retry instead of taking down the whole page; the project state outside is untouched.
 */
export class CanvasBoundary extends Component<CanvasBoundaryProps, { failed: boolean }> {
  static override contextType = MessagesContext;
  declare context: ContextType<typeof MessagesContext>;
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('canvas crashed', error, info.componentStack);
    reportClientError('canvas', error);
  }

  override render(): ReactNode {
    const { children, testId = 'canvas-error' } = this.props;
    if (!this.state.failed)
      return (
        <>
          {children}
          <ThrowProbe target="canvas" />
        </>
      );
    const t = this.props.t ?? this.context?.feedback.canvas;
    if (!t) throw new Error('CanvasBoundary needs a `t` prop or a MessagesContext provider');
    return (
      <ErrorState
        data-testid={testId}
        compact
        icon={<ImageOff />}
        title={t.title}
        description={t.text}
        retryLabel={t.retry}
        onRetry={() => this.setState({ failed: false })}
      />
    );
  }
}
