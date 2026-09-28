export class ConcurrencyLimiter {
  readonly #limit: number;
  #active = 0;
  readonly #queue: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Concurrency limit must be a positive integer.");
    }

    this.#limit = limit;
  }

  run<Result>(task: () => Promise<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const start = () => {
        this.#active += 1;

        void task()
          .then(resolve, reject)
          .finally(() => {
            this.#active -= 1;
            this.#queue.shift()?.();
          });
      };

      if (this.#active < this.#limit) {
        start();
      } else {
        this.#queue.push(start);
      }
    });
  }
}
