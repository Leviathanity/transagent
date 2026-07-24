import { describe, it, expect } from "bun:test";
import { asyncPool } from "./async-pool.js";

describe("asyncPool", () => {
  it("runs all items with correct results", async () => {
    const results = await asyncPool(2, [1, 2, 3], async (n) => n * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("limits concurrency", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const results = await asyncPool(3, [1, 2, 3, 4, 5], async (n) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
      return n;
    });

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBe(3);
  });

  it("handles concurrency 1 (sequential)", async () => {
    const order: number[] = [];
    await asyncPool(1, [1, 2, 3], async (n) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(n);
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("handles empty array", async () => {
    const results = await asyncPool(5, [], async (n) => n);
    expect(results).toEqual([]);
  });

  it("preserves order with variable timing", async () => {
    const results = await asyncPool(3, [3, 1, 2], async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n;
    });
    expect(results).toEqual([3, 1, 2]);
  });
});
