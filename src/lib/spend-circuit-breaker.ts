import { CostBudgetError, ProcessingCapacityError } from "./errors.js";

export interface SpendLimits {
  hourlySpendLimitUsd: number;
  dailySpendLimitUsd: number;
  maxAnalysesPerHour: number;
}

export interface SpendSnapshot {
  hourlyReservedUsd: number;
  dailyReservedUsd: number;
  analysesThisHour: number;
}

export interface SpendReservation {
  id: string;
  projectedUsd: number;
  hourKey: string;
  dayKey: string;
}

export interface AtomicSpendStore {
  beginAnalysis(now: Date, limits: SpendLimits): Promise<SpendSnapshot>;
  reserve(now: Date, projectedUsd: number, limits: SpendLimits): Promise<SpendReservation>;
  reconcile(reservation: SpendReservation, actualUsd: number): Promise<void>;
  snapshot(now: Date): Promise<SpendSnapshot>;
}

function periodKeys(now: Date): { hour: string; day: string } {
  const iso = now.toISOString();
  return { hour: iso.slice(0, 13), day: iso.slice(0, 10) };
}

export class InMemoryAtomicSpendStore implements AtomicSpendStore {
  private readonly hourlySpend = new Map<string, number>();
  private readonly dailySpend = new Map<string, number>();
  private readonly analyses = new Map<string, number>();
  private readonly reservations = new Map<string, SpendReservation>();
  private sequence = 0;

  async beginAnalysis(now: Date, limits: SpendLimits): Promise<SpendSnapshot> {
    const { hour } = periodKeys(now);
    const count = this.analyses.get(hour) ?? 0;
    if (count >= limits.maxAnalysesPerHour) {
      throw new ProcessingCapacityError("Global hourly analysis capacity exceeded.");
    }
    this.analyses.set(hour, count + 1);
    return this.snapshot(now);
  }

  async reserve(now: Date, projectedUsd: number, limits: SpendLimits): Promise<SpendReservation> {
    await Promise.resolve();
    const { hour, day } = periodKeys(now);
    const nextHourly = (this.hourlySpend.get(hour) ?? 0) + projectedUsd;
    const nextDaily = (this.dailySpend.get(day) ?? 0) + projectedUsd;
    if (nextHourly > limits.hourlySpendLimitUsd) {
      throw new ProcessingCapacityError("Global hourly LLM spend limit exceeded.");
    }
    if (nextDaily > limits.dailySpendLimitUsd) {
      throw new ProcessingCapacityError("Global daily LLM spend limit exceeded.");
    }
    this.hourlySpend.set(hour, nextHourly);
    this.dailySpend.set(day, nextDaily);
    const reservation = {
      id: `reservation-${++this.sequence}`,
      projectedUsd,
      hourKey: hour,
      dayKey: day,
    };
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  reconcile(reservation: SpendReservation, actualUsd: number): Promise<void> {
    const stored = this.reservations.get(reservation.id);
    if (!stored) throw new CostBudgetError("Unknown or already reconciled spend reservation.");
    const difference = actualUsd - stored.projectedUsd;
    this.hourlySpend.set(
      stored.hourKey,
      Math.max(0, (this.hourlySpend.get(stored.hourKey) ?? 0) + difference),
    );
    this.dailySpend.set(
      stored.dayKey,
      Math.max(0, (this.dailySpend.get(stored.dayKey) ?? 0) + difference),
    );
    this.reservations.delete(reservation.id);
    return Promise.resolve();
  }

  snapshot(now: Date): Promise<SpendSnapshot> {
    const { hour, day } = periodKeys(now);
    return Promise.resolve({
      hourlyReservedUsd: this.hourlySpend.get(hour) ?? 0,
      dailyReservedUsd: this.dailySpend.get(day) ?? 0,
      analysesThisHour: this.analyses.get(hour) ?? 0,
    });
  }
}

export interface RedisEvalClient {
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
}

const RESERVE_LUA = `
local hourly = tonumber(redis.call("GET", KEYS[1]) or "0")
local daily = tonumber(redis.call("GET", KEYS[2]) or "0")
local amount = tonumber(ARGV[1])
if hourly + amount > tonumber(ARGV[2]) then return {"hourly"} end
if daily + amount > tonumber(ARGV[3]) then return {"daily"} end
redis.call("INCRBYFLOAT", KEYS[1], amount)
redis.call("EXPIRE", KEYS[1], 7200)
redis.call("INCRBYFLOAT", KEYS[2], amount)
redis.call("EXPIRE", KEYS[2], 172800)
redis.call("SET", KEYS[3], amount, "EX", 172800)
return {"ok"}
`;

const RECONCILE_LUA = `
local reserved = tonumber(redis.call("GET", KEYS[3]) or "-1")
if reserved < 0 then return {"missing"} end
local difference = tonumber(ARGV[1]) - reserved
local hourly = math.max(0, tonumber(redis.call("GET", KEYS[1]) or "0") + difference)
local daily = math.max(0, tonumber(redis.call("GET", KEYS[2]) or "0") + difference)
redis.call("SET", KEYS[1], hourly, "EX", 7200)
redis.call("SET", KEYS[2], daily, "EX", 172800)
redis.call("DEL", KEYS[3])
return {"ok"}
`;

export class RedisAtomicSpendStore implements AtomicSpendStore {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly prefix = "loglisted:production:v1:spend",
  ) {}

  async beginAnalysis(now: Date, limits: SpendLimits): Promise<SpendSnapshot> {
    const { hour } = periodKeys(now);
    const result = await this.redis.eval<number>(
      `local current = tonumber(redis.call("GET", KEYS[1]) or "0")
       if current >= tonumber(ARGV[1]) then return -1 end
       local value = redis.call("INCR", KEYS[1])
       redis.call("EXPIRE", KEYS[1], 7200)
       return value`,
      [`${this.prefix}:analyses:${hour}`],
      [limits.maxAnalysesPerHour],
    );
    if (result < 0) throw new ProcessingCapacityError("Global hourly analysis capacity exceeded.");
    return this.snapshot(now);
  }

  async reserve(now: Date, projectedUsd: number, limits: SpendLimits): Promise<SpendReservation> {
    const { hour, day } = periodKeys(now);
    const id = crypto.randomUUID();
    const result = await this.redis.eval<string[]>(
      RESERVE_LUA,
      [
        `${this.prefix}:hour:${hour}`,
        `${this.prefix}:day:${day}`,
        `${this.prefix}:reservation:${id}`,
      ],
      [projectedUsd, limits.hourlySpendLimitUsd, limits.dailySpendLimitUsd],
    );
    if (result[0] !== "ok") {
      throw new ProcessingCapacityError(`Global ${result[0] ?? "unknown"} spend limit exceeded.`);
    }
    return { id, projectedUsd, hourKey: hour, dayKey: day };
  }

  async reconcile(reservation: SpendReservation, actualUsd: number): Promise<void> {
    const result = await this.redis.eval<string[]>(
      RECONCILE_LUA,
      [
        `${this.prefix}:hour:${reservation.hourKey}`,
        `${this.prefix}:day:${reservation.dayKey}`,
        `${this.prefix}:reservation:${reservation.id}`,
      ],
      [actualUsd],
    );
    if (result[0] !== "ok") throw new CostBudgetError("Spend reservation reconciliation failed.");
  }

  async snapshot(now: Date): Promise<SpendSnapshot> {
    const { hour, day } = periodKeys(now);
    const values = await this.redis.eval<[number, number, number]>(
      `return {
         tonumber(redis.call("GET", KEYS[1]) or "0"),
         tonumber(redis.call("GET", KEYS[2]) or "0"),
         tonumber(redis.call("GET", KEYS[3]) or "0")
       }`,
      [
        `${this.prefix}:hour:${hour}`,
        `${this.prefix}:day:${day}`,
        `${this.prefix}:analyses:${hour}`,
      ],
      [],
    );
    return {
      hourlyReservedUsd: values[0] ?? 0,
      dailyReservedUsd: values[1] ?? 0,
      analysesThisHour: values[2] ?? 0,
    };
  }
}

export const PROCESSING_CAPACITY_MESSAGE =
  "We're currently at processing capacity. Please try again later.";
