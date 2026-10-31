"use client";

import { useCallback, useState } from "react";

/** Tracks an element's content size through a callback ref. */
export function useSize(initialWidth = 320, initialHeight = 240) {
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const ref = useCallback((el: Element | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
