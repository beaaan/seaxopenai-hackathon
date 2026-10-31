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
      // The releasing job hands its slot over directly, so `#active` already counts us.
      const { promise, resolve } = Promise.withResolvers<void>();
      this.#waiting.push(resolve);
      await promise;
    } else {
      this.#active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }
}
