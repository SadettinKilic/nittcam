import { beforeEach, describe, expect, it } from 'vitest';
import { initialCommand, rememberPose, resetViewMemory } from './view-memory';

describe('view memory (T160)', () => {
  beforeEach(resetViewMemory);
  it('a fresh 3D view eases from top to isometric', () => {
    expect(initialCommand()).toEqual({ preset: 'iso', from: 'top', nonce: 0, animate: true });
  });
  it('after a camera change the next view restores that pose without an ease', () => {
    const pose = { position: [1, 2, 3], target: [0, 0, 0] } as const;
    rememberPose({ position: [...pose.position], target: [...pose.target] });
    expect(initialCommand()).toMatchObject({ pose, animate: false });
  });
});
