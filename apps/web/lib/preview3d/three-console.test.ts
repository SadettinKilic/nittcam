import { afterEach, describe, expect, it, vi } from 'vitest';
import { threeConsole } from './three-console';

describe('threeConsole (B44, D-080)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drops only the THREE.Clock deprecation warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    threeConsole(
      'warn',
      'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
    );
    expect(warn).not.toHaveBeenCalled();
    threeConsole('warn', 'THREE.WebGLRenderer: Context Lost.');
    expect(warn).toHaveBeenCalledWith('THREE.WebGLRenderer: Context Lost.');
  });

  it('forwards errors and logs unchanged', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    threeConsole('error', 'THREE.Clock: This module has been deprecated', 1);
    threeConsole('log', 'THREE.x', 2);
    expect(error).toHaveBeenCalledWith('THREE.Clock: This module has been deprecated', 1);
    expect(log).toHaveBeenCalledWith('THREE.x', 2);
  });
});
