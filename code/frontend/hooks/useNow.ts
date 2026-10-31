"use client";

import { useSyncExternalStore } from "react";

interface Ticker {
  value: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
}

const tickers = new Map<number, Ticker>();

function tickerFor(ms: number): Ticker {
  let t = tickers.get(ms);
  if (!t) {
    t = { value: Date.now(), listeners: new Set() };
    tickers.set(ms, t);
  }
  return t;
}

/** Current time, re-rendering every `ms`. All callers with the same interval share one timer. 0 on the server. */
export function useNow(ms: number): number {
  return useSyncExternalStore(
    (cb) => {
      const t = tickerFor(ms);
      t.listeners.add(cb);
      t.timer ??= setInterval(() => {
        t.value = Date.now();
        t.listeners.forEach((l) => l());
      }, ms);
      return () => {
        t.listeners.delete(cb);
        if (t.listeners.size === 0) {
          clearInterval(t.timer);
          t.timer = undefined;
        }
      };
    },
    () => tickerFor(ms).value,
    () => 0,
  );
}
