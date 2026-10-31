import { describe, expect, test } from "bun:test";
import { type AdminParking, type AdminRegion, newParking, rectangle, removeCamera, removeRegion, replaceRegion } from "./adminModel";
import { applyCalibration, type CalibrationDraft, drawingIssues, type DraftSubZone, forNewTarget, placeSubZones, polygonsOverlap, selfCrosses, startDraft, targetIssues } from "./calibration";
import { analyze, bestRegion, boxOf, overallChance } from "./geometry";
import { chanceAt, freesUpAt, tightFrom } from "./forecast";
import { recommend, trendOf, type Sample } from "./recommend";
import { clockInZone, isOpenAt, openState } from "./schedule";
import { chanceColor } from "./heat";
import type { ParkingLotConfig, ParkingOccupancy, ParkingSchedule, ZoneOccupancy } from "./types";

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
      { id: "small", slotCount: 2, boundary: square(0, 1) },
      { id: "big", slotCount: 6, boundary: square(1, 3) },
    ],
  },
};

const reading = (zoneId: string, occupancy: number | null, capacity = 6): ZoneOccupancy => ({
  zoneId,
  capacity,
  detected: occupancy === null ? null : occupancy * capacity,
  occupancy,
  overflow: false,
  status: occupancy === null ? "unknown" : "valid",
  cameraCount: occupancy === null ? 0 : 1,
  updatedAt: occupancy === null ? null : "2026-10-31T10:00:00Z",
});

const live = (...zones: ZoneOccupancy[]): ParkingOccupancy => ({ parkingId: "p", updatedAt: null, zones });

describe("analyze", () => {
  const stats = analyze(config, live(reading("small", 0, 2), reading("big", 1)));

  test("the chance of a zone is its estimated free share", () => {
    expect(stats.map((s) => s.chance)).toEqual([1, 0]);
    expect(bestRegion(stats)?.key).toBe("small");
  });

  test("overall chance is weighted by capacity, not by zone count", () => {
    expect(overallChance(stats)).toBeCloseTo(0.25);
  });

  test("a zone without a measurement is unknown, not free and not full", () => {
    const unknown = analyze(config, live(reading("small", null, 2), reading("big", 0.5)));
    expect(unknown[0]).toMatchObject({ chance: null, level: null, detected: null });
    expect(bestRegion(unknown)?.key).toBe("big");
    expect(overallChance(unknown)).toBeCloseTo(0.5);
  });

  test("a zone missing from the answer is unknown too", () => {
    expect(analyze(config, live())[0].chance).toBeNull();
  });

  test("with nothing known, nothing is overall known", () => {
    const none = analyze(config, live(reading("small", null, 2), reading("big", null)));
    expect(overallChance(none)).toBeNull();
    expect(bestRegion(none)).toBeNull();
  });

  test("unknown has its own colour", () => {
    expect(chanceColor(null)).toBe("var(--chance-unknown)");
    expect(chanceColor(0.9)).toContain("--chance-good");
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
  const stats = analyze(config, live(reading("small", 0, 2), reading("big", 1)));
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

  test("never recommends a zone nobody can see", () => {
    const blind = { ...item("blind", true, 0.9), stats: stats.map((s) => ({ ...s, chance: null, level: null })) };
    expect(recommend([blind, item("seen", true, 0.2)])).toMatchObject({ kind: "go", item: { config: { id: "seen" } } });
    expect(recommend([blind])?.kind).toBe("unknown");
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

describe("admin calibration", () => {
  const rect = (x: number, y: number, w: number, h: number) => rectangle(x, y, w, h);
  const quad = [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.4 },
    { x: 0.1, y: 0.5 },
  ];
  const parking = (regions: AdminRegion[] = [], cameras: AdminParking["cameras"] = []): AdminParking => ({ ...newParking("Parking 1", new Set()), geometry: { regions }, cameras });
  const zone = (id: string, boundary = rect(0, 0, 4, 2)): DraftSubZone => ({ id, name: id, capacity: 3, imagePolygon: quad, boundary, existing: false });
  const draft = (subZones: DraftSubZone[]): CalibrationDraft => ({ camera: { id: "cam", name: "Cam" }, subZones, target: { kind: "existing", parkingId: "p" } });

  test("a bow-tie crosses itself, a skewed quad does not", () => {
    expect(selfCrosses(quad)).toBe(false);
    expect(selfCrosses([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(true);
  });

  test("neighbours sharing an edge don't overlap; crossing, nested and identical shapes do", () => {
    expect(polygonsOverlap(rect(0, 0, 2, 2), rect(2, 0, 2, 2))).toBe(false);
    expect(polygonsOverlap(rect(0, 0, 2, 2), rect(5, 5, 2, 2))).toBe(false);
    expect(polygonsOverlap(rect(0, 0, 2, 2), rect(1, 1, 2, 2))).toBe(true);
    expect(polygonsOverlap(rect(0, 0, 6, 6), rect(2, 2, 1, 1))).toBe(true);
    expect(polygonsOverlap(rect(0, 0, 2, 2), rect(0, 0, 2, 2))).toBe(true);
  });

  test("the drawing step needs a named, drawn sub-zone with a capacity", () => {
    expect(drawingIssues([])).toHaveLength(1);
    expect(drawingIssues([{ ...zone("a"), capacity: 0 }])[0]).toContain("capacity");
    expect(drawingIssues([{ ...zone("a"), imagePolygon: [] }])[0]).toContain("isn't drawn");
    expect(drawingIssues([zone("a")])).toEqual([]);
  });

  test("blocks are placed at real size without touching what's on the plan", () => {
    const existing: AdminRegion = { id: "old", slotCount: 1, boundary: rect(0, 0, 10, 10) };
    const placed = placeSubZones([{ ...zone("a", []), capacity: 10 }, zone("b", [])], parking([existing]));
    expect(boxOf(placed[0].boundary)).toEqual({ minX: 0, minY: 12, maxX: 7, maxY: 14 });
    for (const block of placed) expect(polygonsOverlap(block.boundary, existing.boundary)).toBe(false);
    expect(polygonsOverlap(placed[0].boundary, placed[1].boundary)).toBe(false);
  });

  test("a block already placed stays where it is", () => {
    const here = rect(3, 3, 2, 2);
    expect(placeSubZones([zone("a", here)], parking())[0].boundary).toEqual(here);
  });

  test("a new camera adds its sub-zones and its views, and adds up the capacity", () => {
    const other: AdminRegion = { id: "other", slotCount: 5, boundary: rect(0, 0, 2, 2) };
    const result = applyCalibration(parking([other]), draft([zone("a"), zone("b")]), "2026-10-31T10:00:00Z");
    expect(result.geometry.regions.map((r) => r.id)).toEqual(["other", "A", "B"]);
    expect(result.totalSlots).toBe(11);
    expect(result.cameras).toEqual([
      {
        id: "cam",
        name: "Cam",
        calibratedAt: "2026-10-31T10:00:00Z",
        views: [
          { regionId: "A", polygon: quad },
          { regionId: "B", polygon: quad },
        ],
      },
    ]);
  });

  test("a second camera shares a physical zone with its own polygon", () => {
    const shared: AdminRegion = { id: "S", name: "Shared", slotCount: 5, boundary: rect(0, 0, 2, 2) };
    const otherPolygon = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    const first = { id: "cam-1", name: "One", views: [{ regionId: "S", polygon: otherPolygon }] };
    const linked: DraftSubZone = { id: "S", name: "Shared", capacity: 5, imagePolygon: quad, boundary: shared.boundary, existing: true };
    const result = applyCalibration(parking([shared], [first]), draft([linked]), "2026-10-31T10:00:00Z");
    expect(result.geometry.regions).toHaveLength(1);
    expect(result.cameras.map((c) => c.views?.[0].polygon)).toEqual([otherPolygon, quad]);
  });

  test("changing a capacity from one camera changes the zone, not the camera", () => {
    const shared: AdminRegion = { id: "S", name: "Shared", slotCount: 5, boundary: rect(0, 0, 2, 2) };
    const first = { id: "cam-1", name: "One", views: [{ regionId: "S", polygon: quad }] };
    const linked: DraftSubZone = { id: "S", name: "Shared", capacity: 8, imagePolygon: quad, boundary: shared.boundary, existing: true };
    const result = applyCalibration(parking([shared], [first]), draft([linked]), "2026-10-31T10:00:00Z");
    expect(result.geometry.regions[0].slotCount).toBe(8);
    expect(result.totalSlots).toBe(8);
    expect(result.cameras[0]).toEqual(first);
  });

  test("recalibrating replaces that camera's views and never deletes a physical zone", () => {
    const region = (id: string, slotCount = 1): AdminRegion => ({ id, slotCount, boundary: rect(0, 0, 2, 2) });
    const views = [
      { regionId: "keep", polygon: quad },
      { regionId: "gone", polygon: quad },
    ];
    const start = parking([region("keep"), region("other", 5), region("gone")], [{ id: "cam", name: "Renamed by admin", views }]);
    const kept: DraftSubZone = { ...zone("keep"), capacity: 7, existing: true };
    const result = applyCalibration(start, draft([kept]), "2026-10-31T10:00:00Z");
    expect(result.geometry.regions.map((r) => r.id)).toEqual(["keep", "other", "gone"]);
    expect(result.totalSlots).toBe(13);
    expect(result.cameras).toEqual([{ id: "cam", name: "Renamed by admin", calibratedAt: "2026-10-31T10:00:00Z", views: [{ regionId: "keep", polygon: quad }] }]);
  });

  test("recalibrating starts from what the camera already has", () => {
    const region: AdminRegion = { id: "r", name: "Row", slotCount: 4, boundary: rect(0, 0, 2, 2) };
    const camera = { id: "cam", name: "Cam", views: [{ regionId: "r", polygon: quad }] };
    const started = startDraft({ id: "cam", name: "Cam" }, [{ ...parking([region], [camera]), id: "home" }]);
    expect(started.target).toEqual({ kind: "existing", parkingId: "home" });
    expect(started.subZones).toEqual([{ id: "r", name: "Row", capacity: 4, imagePolygon: quad, boundary: region.boundary, existing: true }]);
    expect(drawingIssues(started.subZones)).toEqual([]);
  });

  test("two polygons of one camera can't overlap", () => {
    const shifted = quad.map((p) => ({ x: p.x + 0.1, y: p.y + 0.1 }));
    expect(drawingIssues([zone("a"), { ...zone("b"), imagePolygon: shifted }])[0]).toContain("overlap");
  });

  test("a new zone needs a name", () => {
    expect(targetIssues({ kind: "new", name: " " })).toHaveLength(1);
    expect(targetIssues({ kind: "new", name: "North" })).toEqual([]);
    expect(targetIssues({ kind: "existing", parkingId: "p" })).toEqual([]);
  });

  test("moving a draft to another zone unlinks its sub-zones from the old plan", () => {
    const moved = forNewTarget([{ ...zone("S", rect(1, 1, 2, 2)), existing: true }], "cam");
    expect(moved[0]).toMatchObject({ existing: false, boundary: [], imagePolygon: quad });
    expect(moved[0].id).not.toBe("S");
  });

  test("deleting a zone removes it from every camera; unlinking a camera keeps the zone", () => {
    const region: AdminRegion = { id: "r", slotCount: 4, boundary: rect(0, 0, 2, 2) };
    const cameras = ["a", "b"].map((id) => ({ id, name: id, views: [{ regionId: "r", polygon: quad }] }));
    expect(removeRegion(parking([region], cameras), "r").cameras.map((c) => c.views)).toEqual([[], []]);
    const unlinked = removeCamera(parking([region], cameras), "a");
    expect(unlinked.cameras.map((c) => c.id)).toEqual(["b"]);
    expect(unlinked.geometry.regions).toEqual([region]);
  });

  test("editing a zone's capacity is the zone's alone", () => {
    const region: AdminRegion = { id: "r", slotCount: 4, boundary: rect(0, 0, 2, 2) };
    const result = replaceRegion(parking([region]), { ...region, slotCount: 9 });
    expect(result.totalSlots).toBe(9);
  });

  test("a new zone gets a clean, unique id", () => {
    expect(newParking("Vélo Nord !", new Set()).id).toBe("velo-nord");
    expect(newParking("Parking", new Set(["parking"])).id).not.toBe("parking");
  });
});
