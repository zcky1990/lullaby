/** Minimal 5-field cron (minute hour dom month dow). */

export class CronError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface Field {
  values: Set<number>;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): Field {
  const values = new Set<number>();
  const parts = raw.split(",");
  for (const part of parts) {
    const token = part.trim().toLowerCase();
    if (!token) throw new CronError(`Field cron kosong.`);
    const [rangePart, stepPart] = token.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new CronError(`Step cron tidak valid: ${token}`);
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = resolveNumber(a!, min, max, aliases);
      end = resolveNumber(b!, min, max, aliases);
      if (start > end) throw new CronError(`Rentang cron tidak valid: ${token}`);
    } else {
      start = resolveNumber(rangePart!, min, max, aliases);
      end = start;
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values };
}

function resolveNumber(
  raw: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): number {
  const alias = aliases?.[raw];
  const value = alias ?? Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CronError(`Nilai cron di luar rentang ${min}-${max}: ${raw}`);
  }
  return value;
}

const MONTH_ALIAS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DOW_ALIAS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export interface CronExpression {
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
  raw: string;
}

export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError("Cron harus 5 field: minute hour day month weekday.");
  }
  const minute = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dayOfMonth = parseField(parts[2]!, 1, 31);
  const month = parseField(parts[3]!, 1, 12, MONTH_ALIAS);
  const dayOfWeek = parseField(parts[4]!, 0, 7, DOW_ALIAS);
  if (dayOfWeek.values.has(7)) dayOfWeek.values.add(0);
  return { minute, hour, dayOfMonth, month, dayOfWeek, raw: expression.trim() };
}

function matches(expr: CronExpression, date: Date, timeZone?: string): boolean {
  const parts = zonedParts(date, timeZone);
  if (!expr.month.values.has(parts.month)) return false;
  if (!expr.hour.values.has(parts.hour)) return false;
  if (!expr.minute.values.has(parts.minute)) return false;

  const domMatch = expr.dayOfMonth.values.has(parts.day);
  const dowMatch = expr.dayOfWeek.values.has(parts.weekday);
  const domStar = expr.dayOfMonth.values.size === 31;
  const dowStar = expr.dayOfWeek.values.size >= 7;
  if (domStar && dowStar) return true;
  if (!domStar && !dowStar) return domMatch || dowMatch;
  if (!domStar) return domMatch;
  return dowMatch;
}

function zonedParts(date: Date, timeZone?: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
    };
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    weekday: weekdayMap[bag.weekday ?? ""] ?? 0,
  };
}

/** Next matching instant after `from` (exclusive), UTC ISO string. */
export function nextCronRun(
  expression: string | CronExpression,
  from: Date = new Date(),
  timeZone?: string,
): string {
  const expr = typeof expression === "string" ? parseCron(expression) : expression;
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    if (matches(expr, cursor, timeZone)) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new CronError("Tidak menemukan next run dalam 1 tahun.");
}

export function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
