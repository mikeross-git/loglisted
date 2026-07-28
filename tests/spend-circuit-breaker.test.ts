import { describe, expect, it } from "vitest";
import { ProcessingCapacityError } from "../src/lib/errors.js";
import { InMemoryAtomicSpendStore } from "../src/lib/spend-circuit-breaker.js";

const limits = {
  hourlySpendLimitUsd: 0.5,
  dailySpendLimitUsd: 1,
  maxAnalysesPerHour: 2,
};
const now = new Date("2026-07-26T12:30:00.000Z");

describe("global spend circuit breaker", () => {
  it("enforces hourly analysis capacity", async () => {
    const store = new InMemoryAtomicSpendStore();
    await store.beginAnalysis(now, limits);
    await store.beginAnalysis(now, limits);
    await expect(store.beginAnalysis(now, limits)).rejects.toBeInstanceOf(ProcessingCapacityError);
  });

  it("enforces hourly spend atomically under concurrent reservations", async () => {
    const store = new InMemoryAtomicSpendStore();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => store.reserve(now, 0.1, limits)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
    expect((await store.snapshot(now)).hourlyReservedUsd).toBeCloseTo(0.5);
  });

  it("enforces the daily limit across hour boundaries", async () => {
    const store = new InMemoryAtomicSpendStore();
    await store.reserve(now, 0.5, limits);
    const later = new Date("2026-07-26T13:30:00.000Z");
    await store.reserve(later, 0.5, limits);
    await expect(store.reserve(later, 0.01, limits)).rejects.toBeInstanceOf(
      ProcessingCapacityError,
    );
  });

  it("reconciles projected spend to actual spend", async () => {
    const store = new InMemoryAtomicSpendStore();
    const reservation = await store.reserve(now, 0.4, limits);
    await store.reconcile(reservation, 0.1);
    const snapshot = await store.snapshot(now);
    expect(snapshot.hourlyReservedUsd).toBeCloseTo(0.1);
    expect(snapshot.dailyReservedUsd).toBeCloseTo(0.1);
  });
});
