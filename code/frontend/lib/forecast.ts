// Simulated until the backend exposes history.

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const FIRST_HOUR = 6;
export const LAST_HOUR = 21;
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => i + FIRST_HOUR);

/** Below this chance of a spot, a parking counts as hard to park in; matches the "Nearly full" level. */
export const HARD_TO_PARK = 0.3;

const WEEKDAY_FACTOR = [0.92, 1, 0.98, 0.9, 0.68, 0.06, 0.04];

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function hash(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Gives each parking its own rhythm: a load factor and an earlier or later rush. */
function profile(parkingId: string) {
  const h = hash(parkingId);
  return { load: 0.82 + ((h % 23) / 22) * 0.2, shift: ((h % 17) / 16) * 1.2 - 0.6 };
}

function dayCurve(hour: number): number {
  return 0.05 + 0.95 * sigmoid((hour - 7.35) / 0.55) * (1 - sigmoid((hour - 17.3) / 0.9));
}

export function occupancy(parkingId: string, day: number, hour: number): number {
  const { load, shift } = profile(parkingId);
  return clamp01(dayCurve(hour - shift) * WEEKDAY_FACTOR[day] * load);
}

export const chanceAt = (parkingId: string, day: number, hour: number) => 1 - occupancy(parkingId, day, hour);

export function formatHour(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** First quarter-hour of the morning at which spots get hard to find. */
export function tightFrom(parkingId: string, day: number): number | null {
  for (let h = FIRST_HOUR; h <= 14; h += 0.25) {
    if (chanceAt(parkingId, day, h) <= HARD_TO_PARK) return h;
  }
  return null;
}

/** First quarter-hour after the rush at which spots are easy again. */
export function freesUpAt(parkingId: string, day: number): number | null {
  const start = tightFrom(parkingId, day);
  if (start === null) return null;
  for (let h = start; h <= LAST_HOUR; h += 0.25) {
    if (chanceAt(parkingId, day, h) >= 0.6) return h;
  }
  return null;
}

export function weekAverage(parkingIds: string[], hour: number, days = [0, 1, 2, 3, 4]): number {
  if (parkingIds.length === 0) return 0;
  const total = parkingIds.reduce((sum, id) => sum + days.reduce((s, d) => s + chanceAt(id, d, hour), 0), 0);
  return total / (parkingIds.length * days.length);
}

export function weeklyLow(parkingIds: string[]): { day: number; hour: number; value: number } {
  let low = { day: 0, hour: FIRST_HOUR, value: Infinity };
  for (let day = 0; day < 7; day++) {
    for (const hour of HOURS) {
      const value = weekAverage(parkingIds, hour, [day]);
      if (value < low.value) low = { day, hour, value };
    }
  }
  return low;
}
