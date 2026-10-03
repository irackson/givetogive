export class Semaphore {
  active = 0;
  private queue: Array<() => void> = [];
  limit: number;
  private readonly maximum: number;
  constructor(limit: number, maximum = 4) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 30 || !Number.isInteger(limit) || limit < 1 || limit > maximum) throw new Error('Invalid concurrency limit.');
    this.limit = limit; this.maximum = maximum;
  }
  get waiting() { return this.queue.length; }
  resize(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > this.maximum) throw new Error(`Concurrency must be 1-${this.maximum}.`);
    this.limit = limit;
    this.drain();
  }
  private drain() { while (this.active < this.limit && this.queue.length) this.queue.shift()!(); }
  async run<T>(action: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const admit = () => { this.active++; resolve(); };
      if (this.active < this.limit) admit(); else this.queue.push(admit);
    });
    try { return await action(); } finally { this.active--; this.drain(); }
  }
}
