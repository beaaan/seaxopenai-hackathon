/** FIFO concurrency limiter. */
export class Limiter {
  readonly #max: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error(`Limiter: max must be a positive integer, got ${max}`);
    this.#max = max;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#max) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.#waiting.push(resolve);
      await promise;
    }
    this.#active += 1;
    try {
      return await fn();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
}
