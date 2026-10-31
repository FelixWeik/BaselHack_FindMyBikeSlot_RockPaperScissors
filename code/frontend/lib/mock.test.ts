import { afterEach, describe, expect, test } from "bun:test";
import { deleteMockParking, mockDevices, mockParkings, resetMockParkings, saveMockParking } from "./mock";
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
