import type { Level, RegionStat } from "./geometry";
import type { OpenState } from "./schedule";
import type { ParkingLotConfig } from "./types";

/** Favorites win a near-tie: people prefer their usual spot unless another is clearly better. */
const FAVORITE_BONUS = 0.1;
/** The current pick must be clearly beaten, or a near-tie would flip the answer on every poll. */
const HOLD_BONUS = 0.05;

interface Candidate {
  config: ParkingLotConfig;
  stats: RegionStat[] | null;
  openState: OpenState;
}

export type Recommendation<T extends Candidate> =
  | { kind: "go"; level: Level; item: T; stat: RegionStat }
  | { kind: "closed"; item: T };

export interface HeldPick {
  parkingId: string;
  key: string;
}

export function recommend<T extends Candidate>(
  items: T[],
  favorites: string[] = [],
  held: HeldPick | null = null,
): Recommendation<T> | null {
  let best: { item: T; stat: RegionStat; score: number } | null = null;
  for (const item of items) {
    if (!item.openState.open || !item.stats) continue;
    const bonus = favorites.includes(item.config.id) ? FAVORITE_BONUS : 0;
    for (const stat of item.stats) {
      const isHeld = held?.parkingId === item.config.id && held.key === stat.key;
      const score = stat.chance + bonus + (isHeld ? HOLD_BONUS : 0);
      if (!best || score > best.score) best = { item, stat, score };
    }
  }
  if (best) return { kind: "go", level: best.stat.level, item: best.item, stat: best.stat };

  const known = items.filter((i) => i.stats);
  return known.length > 0 ? { kind: "closed", item: known[0] } : null;
}

export interface Sample {
  t: number;
  overall: number;
  zones: Record<string, number>;
}

export type Trend = "up" | "down" | "flat";

const TREND_WINDOW_MS = 2 * 60_000;
const TREND_THRESHOLD = 0.03;

/** Compares now with about two minutes ago; null until there is a minute of history. */
export function trendOf(samples: Sample[], read: (s: Sample) => number | undefined = (s) => s.overall): Trend | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  if (last.t - samples[0].t < 60_000) return null;
  const then = samples.find((s) => last.t - s.t <= TREND_WINDOW_MS) ?? samples[0];
  const a = read(then);
  const b = read(last);
  if (a === undefined || b === undefined) return null;
  const delta = b - a;
  return delta > TREND_THRESHOLD ? "up" : delta < -TREND_THRESHOLD ? "down" : "flat";
}

export const TREND_LABEL: Record<Trend, string> = {
  up: "Freeing up",
  down: "Filling up",
  flat: "Steady",
};
