/**
 * Frame-rate watch of the 3D preview (D-033): "Basit mod" switches on by itself when the scene
 * renders below 30 fps for 3 s. The scene renders on demand, so only continuous runs of frames
 * (orbiting, an ease) are measured; a pause longer than `gapMs` starts a new run.
 */
export class FpsWatch {
  private times: number[] = [];
  private fired = false;

  constructor(
    private readonly minFps = 30,
    private readonly windowMs = 3000,
    private readonly gapMs = 250,
  ) {}

  /** Records a frame at `t` ms; true exactly once, when the scene is too slow. */
  frame(t: number): boolean {
    if (this.fired) return false;
    const last = this.times[this.times.length - 1];
    if (last !== undefined && t - last > this.gapMs) this.times = [];
    this.times.push(t);
    const first = this.times[0] ?? t;
    if (t - first < this.windowMs) return false;
    while (this.times.length > 2 && t - (this.times[1] ?? t) >= this.windowMs) this.times.shift();
    const span = t - (this.times[0] ?? t);
    const fps = ((this.times.length - 1) * 1000) / span;
    if (fps < this.minFps) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
