import type { Clock, ParkingSchedule, Weekday } from "./types";

export const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEEK_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CLOSING_SOON_HOURS = 0.5;

export interface OpenState {
  open: boolean;
  closingSoon: boolean;
  label: string;
}

export function parseHour(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + (m || 0) / 60;
}

const shortTime = (hhmm: string) => hhmm.replace(/^0(\d)/, "$1");

export function clockInZone(timezone: string, date: Date): Clock {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return {
      day: WEEK.indexOf(read("weekday").toLowerCase().slice(0, 3) as Weekday),
      hour: Number(read("hour")) + Number(read("minute")) / 60,
    };
  } catch {
    return { day: (date.getDay() + 6) % 7, hour: date.getHours() + date.getMinutes() / 60 };
  }
}

export function isOpenAt(schedule: ParkingSchedule, day: number, hour: number): boolean {
  return (schedule.weekly[WEEK[day]] ?? []).some((w) => hour >= parseHour(w.start) && hour < parseHour(w.end));
}

export function openState(schedule: ParkingSchedule, clock: Clock): OpenState {
  const today = schedule.weekly[WEEK[clock.day]] ?? [];
  const current = today.find((w) => clock.hour >= parseHour(w.start) && clock.hour < parseHour(w.end));
  if (current) {
    const closingSoon = parseHour(current.end) - clock.hour <= CLOSING_SOON_HOURS;
    return {
      open: true,
      closingSoon,
      label: `${closingSoon ? "Closes at" : "Open until"} ${shortTime(current.end)}`,
    };
  }

  const later = today.find((w) => parseHour(w.start) > clock.hour);
  if (later) return { open: false, closingSoon: false, label: `Opens at ${shortTime(later.start)}` };

  for (let offset = 1; offset <= 7; offset++) {
    const day = (clock.day + offset) % 7;
    const first = schedule.weekly[WEEK[day]]?.[0];
    if (first) {
      const when = offset === 1 ? "tomorrow" : WEEK_LABEL[day];
      return { open: false, closingSoon: false, label: `Opens ${when} at ${shortTime(first.start)}` };
    }
  }
  return { open: false, closingSoon: false, label: "Closed" };
}
