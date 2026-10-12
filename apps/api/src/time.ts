import { DateTime } from "luxon";
import { HttpError } from "./security.js";
export const timezone = "Europe/Madrid";
export function instant(value: string) {
  const date = DateTime.fromISO(value, { setZone: true });
  if (!date.isValid) throw new HttpError(400, "INVALID_DATE");
  return date.toUTC().toISO()!;
}
export function fishingDay(value: string) {
  let local = DateTime.fromISO(value, { setZone: true }).setZone(timezone);
  if (!local.isValid) throw new HttpError(400, "INVALID_DATE");
  if (local.hour < 6) local = local.minus({ days: 1 });
  return local.toISODate()!;
}
export const civilDate = (value: string) =>
  DateTime.fromISO(value, { setZone: true }).setZone(timezone).toISODate()!;
export function leagueBounds(first: string, last: string) {
  const start = DateTime.fromISO(first, { zone: timezone }).set({ hour: 6 }),
    end = DateTime.fromISO(last, { zone: timezone })
      .plus({ days: 1 })
      .set({ hour: 6 });
  if (!start.isValid || !end.isValid || end <= start)
    throw new HttpError(400, "INVALID_DATE");
  return { start: start.toUTC().toISO()!, end: end.toUTC().toISO()! };
}
export function unionHours(
  intervals: { start_at: string; end_at: string | null }[],
  now = new Date().toISOString(),
) {
  const sorted = intervals
    .map((x) => [Date.parse(x.start_at), Date.parse(x.end_at ?? now)] as const)
    .filter((x) => x[1] >= x[0])
    .sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return 0;
  let total = 0,
    start = sorted[0]![0],
    end = sorted[0]![1];
  for (const interval of sorted.slice(1)) {
    if (interval[0] > end) {
      total += end - start;
      [start, end] = interval;
    } else end = Math.max(end, interval[1]);
  }
  return (total + end - start) / 3600000;
}
