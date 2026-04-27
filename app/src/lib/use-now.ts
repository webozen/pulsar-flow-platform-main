"use client";

import { useEffect, useState } from "react";

/**
 * Re-renders the calling component every `intervalMs` so relative-time
 * pills (`timeAgo(start, now)`) stay current without a data refetch.
 *
 * Usage:
 *   const now = useNow();
 *   <span>{timeAgo(approval.startedAt, now)}</span>
 *
 * Default 30s — granular enough that "just now" / "a minute ago"
 * transitions feel live, coarse enough that we're not thrashing the
 * render tree. Pass a smaller interval for second-resolution pills.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
