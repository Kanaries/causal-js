/**
 * Indexed min-heap with lazy deletion, mirroring causal-learn's
 * utils/PriorityQueue.py: push/pop by priority with FIFO tie-breaking,
 * plus O(1) get(key) and delete(key) (tombstoning) for decrease-key.
 */
export class IndexedPriorityQueue<K, V> {
  private readonly heap: { priority: number; sequence: number; key: K; value: V }[] = [];
  private readonly index = new Map<K, { priority: number; sequence: number; key: K; value: V }>();
  private readonly removed = new Set<number>();
  private sequenceCounter = 0;

  get size(): number {
    return this.index.size;
  }

  push(key: K, value: V, priority: number): void {
    const entry = { priority, sequence: this.sequenceCounter, key, value };
    this.sequenceCounter += 1;
    this.index.set(key, entry);
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): { key: K; value: V; priority: number } | undefined {
    while (this.heap.length > 0) {
      const top = this.heap[0]!;
      this.extractTop();
      if (this.removed.has(top.sequence)) {
        this.removed.delete(top.sequence);
        continue;
      }
      this.index.delete(top.key);
      return { key: top.key, value: top.value, priority: top.priority };
    }
    return undefined;
  }

  get(key: K): V | undefined {
    return this.index.get(key)?.value;
  }

  delete(key: K): void {
    const entry = this.index.get(key);
    if (entry) {
      this.removed.add(entry.sequence);
      this.index.delete(key);
    }
  }

  private extractTop(): void {
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
  }

  private lessThan(a: number, b: number): boolean {
    const left = this.heap[a]!;
    const right = this.heap[b]!;
    return (
      left.priority < right.priority ||
      (left.priority === right.priority && left.sequence < right.sequence)
    );
  }

  private bubbleUp(start: number): void {
    let position = start;
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.lessThan(position, parent)) {
        const tmp = this.heap[position]!;
        this.heap[position] = this.heap[parent]!;
        this.heap[parent] = tmp;
        position = parent;
      } else {
        break;
      }
    }
  }

  private bubbleDown(start: number): void {
    let position = start;
    while (true) {
      const left = 2 * position + 1;
      const right = 2 * position + 2;
      let smallest = position;
      if (left < this.heap.length && this.lessThan(left, smallest)) {
        smallest = left;
      }
      if (right < this.heap.length && this.lessThan(right, smallest)) {
        smallest = right;
      }
      if (smallest === position) {
        break;
      }
      const tmp = this.heap[position]!;
      this.heap[position] = this.heap[smallest]!;
      this.heap[smallest] = tmp;
      position = smallest;
    }
  }
}
