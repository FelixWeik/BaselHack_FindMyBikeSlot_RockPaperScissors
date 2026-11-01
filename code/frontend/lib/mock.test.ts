import { afterEach, describe, expect, test } from "bun:test";
import { deleteMockParking, getDebug, mockDevices, mockOccupancy, mockParkings, resetMockParkings, saveMockParking, setDebug } from "./mock";
import type { ParkingLotConfig } from "./types";

afterEach(() => {
  delete (globalThis as { __fmbsParkings?: unknown; __fmbsParkingsCleared?: unknown }).__fmbsParkings;
  delete (globalThis as { __fmbsParkings?: unknown; __fmbsParkingsCleared?: unknown }).__fmbsParkingsCleared;
});

const custom: ParkingLotConfig = {
  version: 1,
  id: "custom",
  name: "My parking",
  totalSlots: 1,
  geometry: { regions: [] },
  slotSize: { widthMeters: 0.7, lengthMeters: 2 },
  schedule: { timezone: "Europe/Zurich", weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } },
  cameras: [],
};

describe("mock parking reset", () => {
  test("clears the seeded mock parkings and keeps custom ones", () => {
    resetMockParkings();
    expect(mockParkings()).toEqual([]);
    expect(mockDevices().map((device) => device.id)).toEqual(["cam-shelter-bus", "cam-shelter-entrance"]);

    saveMockParking(custom);
    expect(mockParkings()).toEqual([custom]);

    deleteMockParking(custom.id);
    expect(mockParkings()).toEqual([]);
  });
});

describe("pinned counts", () => {
  test("replace the simulated reading of a zone until they are cleared", () => {
    setDebug({ counts: { "p1:A": 7 } });
    const zone = mockOccupancy("p1", Date.now(), getDebug())?.zones.find((z) => z.zoneId === "A");
    expect(zone).toMatchObject({ detected: 7, capacity: 18, status: "valid", overflow: false });
    expect(zone?.occupancy).toBeCloseTo(7 / 18, 2);

    setDebug({ counts: {} });
    const other = mockOccupancy("p1", Date.now(), getDebug())?.zones.find((z) => z.zoneId === "A");
    expect(other?.detected).not.toBe(7);
  });
});
