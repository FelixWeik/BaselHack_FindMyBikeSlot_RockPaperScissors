"use client";

import Link from "next/link";
import { useLive, type Connection } from "@/hooks/useLive";
import { useNow } from "@/hooks/useNow";
import { OfflineIcon } from "@/components/ui/Icons";
import { Card } from "@/components/ui/primitives";

export function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86_400)} d`;
}

/** Ticks on its own so the rest of the screen doesn't re-render every second. */
export function useAge(fetchedAt: number | null): number | null {
  const now = useNow(1000);
  if (fetchedAt === null || now === 0) return null;
  return Math.max(0, Math.floor((now - fetchedAt) / 1000));
}

function pillStyle(connection: Connection, age: number | null) {
  if (connection === "offline") return { tone: "text-warn", text: "Offline" };
  if (connection === "failing") return { tone: "text-danger", text: "Retrying" };
  if (age !== null && age >= 45) return { tone: "text-danger", text: `${formatAge(age)} old` };
  if (age !== null && age >= 15) return { tone: "text-warn", text: `${formatAge(age)} ago` };
  return { tone: "text-text", text: "Live" };
}

export function LiveStatus() {
  const { connection, fetchedAt, refresh } = useLive();
  const age = useAge(fetchedAt);
  const { tone, text } = pillStyle(connection, age);
  const isLive = text === "Live";

  return (
    <button
      onClick={() => void refresh()}
      aria-label={`${text}${age !== null ? `, updated ${formatAge(age)} ago` : ""}. Refresh now`}
      className={`tap mt-1 flex h-9 shrink-0 items-center gap-2 rounded-full bg-surface px-3 text-xs font-semibold tabular-nums shadow-card ${tone}`}
    >
      {connection === "offline" ? (
        <OfflineIcon size={14} />
      ) : (
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${isLive ? "live-dot" : "bg-current"}`}
          style={isLive ? { background: "var(--chance-good)", color: "var(--chance-good)" } : undefined}
        />
      )}
      {text}
    </button>
  );
}

/** The server answered and has no parking yet: nothing is loading anymore, and the admin is where they're created. */
export function NoParkings() {
  return (
    <Card className="grid justify-items-start gap-3 p-5">
      <p className="font-display text-2xl font-bold">No parking yet</p>
      <p className="text-muted">Set one up in the admin: pick a camera, then draw the zones it watches.</p>
      <Link href="/admin" className="tap inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-semibold text-primary-fg">
        Open the admin
      </Link>
    </Card>
  );
}

/** Spells out what the pill hints at when the numbers on screen can't be trusted as current. */
export function StaleNotice() {
  const { connection, fetchedAt } = useLive();
  const age = useAge(fetchedAt);
  const stale = age !== null && age >= 45;
  if (connection === "live" && !stale) return null;

  const when = age !== null ? ` from ${formatAge(age)} ago` : "";
  const text =
    connection === "offline"
      ? `You're offline. Showing the last known state${when}.`
      : connection === "failing"
        ? `Can't reach the server. Showing the last known state${when}, retrying.`
        : `This data is out of date. Last update${when}.`;

  return (
    <p role="status" className={`mb-4 rounded-2xl border border-current bg-surface px-4 py-3 text-sm font-medium ${connection === "offline" ? "text-warn" : "text-danger"}`}>
      {text}
    </p>
  );
}

export function UnreachableState() {
  const { refresh, connection } = useLive();
  return (
    <div className="flex flex-col items-center gap-3 rounded-[1.75rem] bg-surface p-8 text-center shadow-card">
      <OfflineIcon size={32} />
      <h2 className="font-display text-xl font-semibold">
        {connection === "offline" ? "You're offline" : "Can't reach the server"}
      </h2>
      <p className="max-w-xs text-muted">Nothing is saved on this device yet. It will show up as soon as you&apos;re connected once.</p>
      <button onClick={() => void refresh()} className="tap mt-1 min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-fg">
        Try again
      </button>
    </div>
  );
}
