export class Semaphore {
  active = 0;
  private queue: Array<() => void> = [];
  limit: number;
  constructor(limit: number) { this.limit = limit; }
  get waiting() { return this.queue.length; }
  resize(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 4) throw new Error('Concurrency must be 1-4.');
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
