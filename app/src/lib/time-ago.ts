/**
 * Compact relative-time formatter.
 *
 * Returns short forms like "3 min ago", "2 h ago", "yesterday",
 * "Apr 25". Anything over 7 days falls back to a date stamp. Returns
 * `"—"` for null/undefined/unparseable input — matching the defensive
 * `fmt*` helpers across the app so callers can pass a Kestra
 * `state.startDate` or `state.endDate` without null-checking first.
 *
 * Uses `Intl.RelativeTimeFormat` so locale-aware formatting comes for
 * free; the unit choice keeps it short for dashboards and audit logs.
 */
export function timeAgo(input: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (input == null) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - now.getTime();
  const sec = Math.round(diffMs / 1000);
  const absSec = Math.abs(sec);

  if (absSec < 45) return "just now";

  const min = Math.round(sec / 60);
  if (Math.abs(min) < 45) return rtf().format(min, "minute");

  const hr = Math.round(sec / 3600);
  if (Math.abs(hr) < 24) return rtf().format(hr, "hour");

  const day = Math.round(sec / 86400);
  if (Math.abs(day) <= 7) return rtf().format(day, "day");

  // Older than a week → date stamp ("Apr 25" or "Apr 25, 2025" if previous year).
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** Lazy-init shared RTF instance — building one is mildly expensive. */
let _rtf: Intl.RelativeTimeFormat | null = null;
function rtf(): Intl.RelativeTimeFormat {
  if (!_rtf) _rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  return _rtf;
}

/** Full ISO/locale string for the `title` attr — hovering reveals the
 *  exact timestamp behind a relative pill. */
export function fullTimestamp(input: string | number | Date | null | undefined): string {
  if (input == null) return "";
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}
