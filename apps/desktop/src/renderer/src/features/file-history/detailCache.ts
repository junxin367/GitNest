/** Dialog-local LRU; weight includes strings and a conservative allowance for object overhead. */
export class DetailCache<T> {
  private readonly entries = new Map<string, { value: T; weight: number }>();
  private totalWeight = 0;

  constructor(private readonly maxEntries: number, private readonly maxWeight: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, weight: number) {
    const previous = this.entries.get(key);
    if (previous) {
      this.totalWeight -= previous.weight;
      this.entries.delete(key);
    }
    if (weight > this.maxWeight) return;
    this.entries.set(key, { value, weight });
    this.totalWeight += weight;
    while (this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.entries.keys().next().value!;
      this.totalWeight -= this.entries.get(oldest)!.weight;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.entries.clear();
    this.totalWeight = 0;
  }
}
