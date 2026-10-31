"use client";

import { Card, SectionTitle } from "@/components/ui/primitives";
import type { OpeningWindow, ParkingSchedule, Weekday } from "@/lib/types";

const DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DEFAULT_WINDOW: OpeningWindow = { start: "06:00", end: "20:00" };
const TIMEZONES = ["Europe/Zurich", "UTC", "Europe/Berlin", "Europe/Paris", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Asia/Tokyo"] as const;

const inputClass = "min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3";

export function ScheduleEditor({ schedule, onChange }: { schedule: ParkingSchedule; onChange: (schedule: ParkingSchedule) => void }) {
  const setDay = (day: Weekday, windows: OpeningWindow[]) => onChange({ ...schedule, weekly: { ...schedule.weekly, [day]: windows } });

  return (
    <Card className="grid gap-3 p-4">
      <SectionTitle>Schedule</SectionTitle>
      <label className="grid gap-2 text-sm">
        <span className="text-muted">Timezone</span>
        <select className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={schedule.timezone} onChange={(e) => onChange({ ...schedule, timezone: e.target.value })}>
          {Array.from(new Set([schedule.timezone, ...TIMEZONES])).map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2">
        {DAYS.map((day) => {
          const window = schedule.weekly[day][0];
          return (
            <div key={day} className="grid min-w-0 gap-2 rounded-2xl bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="capitalize">{day}</strong>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={Boolean(window)} onChange={(e) => setDay(day, e.target.checked ? [window ?? DEFAULT_WINDOW] : [])} />
                  Open
                </label>
              </div>
              {window ? (
                <div className="grid grid-cols-2 gap-2">
                  <input type="time" aria-label={`${day} opens`} className={inputClass} value={window.start} onChange={(e) => setDay(day, [{ ...window, start: e.target.value }])} />
                  <input type="time" aria-label={`${day} closes`} className={inputClass} value={window.end} onChange={(e) => setDay(day, [{ ...window, end: e.target.value }])} />
                </div>
              ) : (
                <span className="text-sm text-muted">Closed</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
