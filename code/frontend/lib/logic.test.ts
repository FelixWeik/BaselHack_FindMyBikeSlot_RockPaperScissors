import { describe, expect, test } from "bun:test";
import { analyze, bestRegion, overallChance } from "./geometry";
import { chanceAt, freesUpAt, tightFrom } from "./forecast";
import { recommend, trendOf, type Sample } from "./recommend";
import { clockInZone, isOpenAt, openState } from "./schedule";
import type { ParkingHeatmap, ParkingLotConfig, ParkingSchedule } from "./types";

const weekly = (start: string, end: string): ParkingSchedule => ({
  timezone: "Europe/Zurich",
  weekly: {
    mon: [{ start, end }],
    tue: [{ start, end }],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
});

const square = (x: number, w: number) => [
  { x, y: 0 },
  { x: x + w, y: 0 },
  { x: x + w, y: 2 },
  { x, y: 2 },
];

const config: ParkingLotConfig = {
  version: 1,
  id: "p",
  name: "P",
  totalSlots: 10,
  slotSize: { widthMeters: 1, lengthMeters: 2 },
  schedule: weekly("08:00", "18:00"),
  cameras: [],
  geometry: {
    regions: [
      { id: "small", boundary: square(0, 1) },
      { id: "big", boundary: square(1, 3) },
    ],
  },
};

const heat: ParkingHeatmap = {
  version: 1,
  geometry: config.geometry,
  heatmap: {
    origin: { x: 0.5, y: 0.5 },
    cellSizeMeters: 1,
    probabilities: [
      [1, 0, 0, 0],
      [1, 0, 0, 0],
    ],
  },
};

describe("analyze", () => {
  const stats = analyze(config, heat);

  test("averages cells per region", () => {
    expect(stats.map((s) => s.chance)).toEqual([1, 0]);
    expect(bestRegion(stats)?.key).toBe("small");
  });

  test("overall chance is weighted by area, not by zone count", () => {
    expect(overallChance(stats)).toBeCloseTo(0.25);
  });

  test("a region without cells has no chance rather than NaN", () => {
    const empty = analyze({ ...config, geometry: { regions: [{ id: "x", boundary: square(50, 1) }] } }, heat);
    expect(empty[0].chance).toBe(0);
    expect(overallChance(empty)).toBe(0);
  });
});

describe("openState", () => {
  const s = weekly("08:00", "18:00");

  test("open, closing soon, later today, next open day", () => {
    expect(openState(s, { day: 0, hour: 12 })).toMatchObject({ open: true, label: "Open until 18:00" });
    expect(openState(s, { day: 0, hour: 17.75 })).toMatchObject({ open: true, closingSoon: true, label: "Closes at 18:00" });
    expect(openState(s, { day: 0, hour: 7 })).toMatchObject({ open: false, label: "Opens at 8:00" });
    expect(openState(s, { day: 0, hour: 19 })).toMatchObject({ open: false, label: "Opens tomorrow at 8:00" });
    expect(openState(s, { day: 2, hour: 12 })).toMatchObject({ open: false, label: "Opens Mon at 8:00" });
  });

  test("end of a window is exclusive", () => {
    expect(isOpenAt(s, 0, 18)).toBe(false);
    expect(isOpenAt(s, 0, 8)).toBe(true);
  });

  test("clock follows the parking's timezone, not the device's", () => {
    // Saturday 2026-10-31 23:30 UTC is already Sunday 00:30 in Zurich.
    expect(clockInZone("Europe/Zurich", new Date("2026-10-31T23:30:00Z"))).toEqual({ day: 6, hour: 0.5 });
  });

  test("an invalid timezone falls back instead of throwing", () => {
    expect(clockInZone("Nope/Nowhere", new Date()).day).toBeGreaterThanOrEqual(0);
  });
});

describe("recommend", () => {
  const stats = analyze(config, heat);
  const item = (id: string, open: boolean, chance: number) => ({
    config: { ...config, id },
    stats: stats.map((s) => ({ ...s, chance })),
    openState: { open, closingSoon: false, label: "" },
  });

  test("never sends people to a closed parking", () => {
    const rec = recommend([item("closed", false, 0.9), item("open", true, 0.2)]);
    expect(rec?.kind === "go" && rec.item.config.id).toBe("open");
  });

  test("favorite wins a near-tie but not a clear gap", () => {
    expect(recommend([item("a", true, 0.5), item("fav", true, 0.45)], ["fav"])).toMatchObject({ item: { config: { id: "fav" } } });
    expect(recommend([item("a", true, 0.9), item("fav", true, 0.45)], ["fav"])).toMatchObject({ item: { config: { id: "a" } } });
  });

  test("keeps the current pick through a near-tie, drops it when clearly beaten", () => {
    const held = { parkingId: "a", key: "small" };
    expect(recommend([item("a", true, 0.5), item("b", true, 0.52)], [], held)).toMatchObject({ item: { config: { id: "a" } } });
    expect(recommend([item("a", true, 0.5), item("b", true, 0.7)], [], held)).toMatchObject({ item: { config: { id: "b" } } });
  });

  test("reports closed when nothing is open", () => {
    expect(recommend([item("a", false, 0.9)])?.kind).toBe("closed");
  });
});

describe("trendOf", () => {
  const sample = (t: number, overall: number): Sample => ({ t, overall, zones: {} });

  test("needs a minute of history", () => {
    expect(trendOf([sample(0, 0.5), sample(30_000, 0.9)])).toBeNull();
  });

  test("detects direction and ignores noise", () => {
    expect(trendOf([sample(0, 0.5), sample(90_000, 0.7)])).toBe("up");
    expect(trendOf([sample(0, 0.5), sample(90_000, 0.3)])).toBe("down");
    expect(trendOf([sample(0, 0.5), sample(90_000, 0.51)])).toBe("flat");
  });
});

describe("forecast", () => {
  test("parkings have distinct rhythms", () => {
    expect(chanceAt("p1", 1, 8)).not.toBe(chanceAt("p2", 1, 8));
  });

  test("weekdays get tight in the morning then free up; Sunday stays easy", () => {
    const from = tightFrom("p1", 1);
    expect(from).not.toBeNull();
    expect(freesUpAt("p1", 1)!).toBeGreaterThan(from!);
    expect(tightFrom("p1", 6)).toBeNull();
  });
});
